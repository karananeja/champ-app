import {
  FAULT_UNDONE_CLOSE_REASON,
  FITMENT_ACTION_EVENTS,
  FITMENT_STATUS_LABELS,
  TRANSITIONS,
  VERIFICATION_FIELD_KEYS,
  canApproveFitments,
  canPerform,
  canTransition,
  formatOmId,
  formatTkId,
  toNameKey,
  transitionRefusal,
  type ApproveFitmentsResponse,
  type FitmentAction,
  type Role,
  type TransitionPayload,
  type TransitionResponse,
} from '@champ/shared';
import type { Prisma } from '../../generated/prisma/client';
import { nextNumber } from '../../lib/counters';
import { HttpError, conflict, forbidden, notFound } from '../../lib/errors';
import { prisma, type User } from '../../lib/prisma';
import { requireActiveLookup } from '../masters/refs';
import { countFitments, fitmentInclude, toFitmentDto } from '../tasks/dto';
import { writeEvent } from '../tasks/events';
import { lockTask, recomputeTaskStatus } from '../tasks/status';
import { verifyFitmentFields } from '../verification/service';
import { assertRouteOrder } from '../mobile/route';
import { assertReadyToSubmit } from '../mobile/form';

type Tx = Prisma.TransactionClient;

export interface TransitionOptions {
  /** Done through the dev simulator (D-073): the event data gets `simulated: true`. */
  simulated?: boolean;
  /** Whose view the response is built for (the simulator's caller); defaults to the actor. */
  viewer?: User;
  /**
   * Runs inside the transaction after the fitment was updated and its event written (the simulator attaches
   * sample photos and OT remarks to a SUBMIT here, F06).
   */
  afterApply?: (tx: Tx, fitment: { id: string; taskId: string; tkId: string }) => Promise<void>;
  /**
   * Runs inside the transaction after the permission and status checks, before the action's own checks (the
   * simulator fills the technician form and sample photos here so its SUBMIT passes the F10B form check).
   */
  beforeApply?: (tx: Tx, fitment: { id: string; taskId: string; tkId: string }) => Promise<void>;
}

/** Why `canPerform` refused, in words. */
const NOT_ALLOWED: Record<FitmentAction, string> = {
  START: 'Only the assigned technician can start this fitment',
  SUBMIT: 'Only the assigned technician can submit this fitment',
  CLOSE_NOT_DONE: 'Only the assigned technician can close this fitment as not done',
  MARK_FAULTY: 'Only the assigned technician can mark this fitment faulty',
  VERIFY: "Only the task's operation executive can verify this fitment",
  APPROVE: 'Only an operations manager can final-approve fitments',
  REOPEN: "Only an operations manager or the task's operation executive can reopen this fitment",
  UNDO_FAULTY: "Only an operations manager or the task's operation executive can undo the fault marking",
};

/**
 * The payload fields worth keeping in the event (no empty note). VERIFY's inline verification fields are left
 * out: they get their own FITMENT_VERIFICATION_SAVED event with a readable diff (F06).
 */
const cleanPayload = (payload: TransitionPayload) =>
  Object.fromEntries(
    Object.entries(payload).filter(
      ([k, v]) => v !== undefined && v !== null && v !== '' && !(VERIFICATION_FIELD_KEYS as string[]).includes(k),
    ),
  );

/**
 * Moves a fitment through the workflow (spec §3) in one transaction: locks the task and the fitment row,
 * checks the actor (403 FORBIDDEN) and the current status (409 INVALID_TRANSITION), validates references,
 * applies the status and its timestamps, creates the replacement of a faulty fitment (D-012), records reopen
 * attributions (D-074), undoes a mistaken faulty and closes its replacement (D-257), writes the TaskEvent and
 * recomputes the task status.
 */
export async function transitionFitment(
  actor: User,
  fitmentId: string,
  action: FitmentAction,
  payload: TransitionPayload = {},
  opts: TransitionOptions = {},
): Promise<TransitionResponse> {
  const located = await prisma.fitment.findUnique({ where: { id: fitmentId }, select: { taskId: true } });
  if (!located) throw notFound('Fitment not found');

  await prisma.$transaction(async (tx) => {
    // Task first, then the fitment: the same order as assignment, so the two never deadlock.
    await lockTask(tx, located.taskId);
    await tx.$queryRaw`SELECT "id" FROM "Fitment" WHERE "id" = ${fitmentId} FOR UPDATE`;
    const fitment = await tx.fitment.findUniqueOrThrow({
      where: { id: fitmentId },
      include: { task: { select: { id: true, oeId: true, deletedAt: true, fitmentAt: true } } },
    });
    if (fitment.task.deletedAt) throw notFound('Fitment not found');

    const ctx = { task: fitment.task, fitment };
    if (!canPerform(action, actor, ctx)) throw forbidden('FORBIDDEN', NOT_ALLOWED[action]);
    if (!canTransition(action, fitment.status)) {
      throw conflict('INVALID_TRANSITION', transitionRefusal(action, fitment.status));
    }
    // F10 (D-156): the technician starts fitments in the stored day-route order; closing and faulty aren't restricted.
    if (action === 'START' && fitment.technicianId) await assertRouteOrder(tx, fitment.technicianId, fitment);
    if (opts.beforeApply) await opts.beforeApply(tx, { id: fitmentId, taskId: fitment.taskId, tkId: formatTkId(fitment.tkNo) });
    if (action === 'CLOSE_NOT_DONE') await requireActiveLookup(payload.closeReasonId ?? '', 'CLOSE_REASON', 'closeReasonId');
    const undone = action === 'UNDO_FAULTY' ? await lockUnstartedReplacement(tx, fitment) : null;

    const now = new Date();
    const toStatus = TRANSITIONS[action].to;
    const tkId = formatTkId(fitment.tkNo);
    const data: Prisma.FitmentUncheckedUpdateInput = { status: toStatus };
    const extraEventData: Record<string, unknown> = {};
    switch (action) {
      case 'START':
        Object.assign(data, { startedAt: now, startLat: payload.lat, startLng: payload.lng });
        break;
      case 'SUBMIT':
        // F10B: the form and the required photos must be complete; the event keeps a snapshot of the form.
        extraEventData.form = await assertReadyToSubmit(tx, fitmentId);
        data.submittedAt = now;
        break;
      case 'CLOSE_NOT_DONE':
        Object.assign(data, { closedAt: now, closeReasonId: payload.closeReasonId, closeComments: payload.comments });
        break;
      case 'MARK_FAULTY':
        Object.assign(data, { faultyAt: now, faultReason: payload.reason });
        break;
      case 'VERIFY': {
        // F06: inline fields are saved first; the required fields must then be filled (D-098), and billable is
        // snapshotted from the final issue's current flag (D-101).
        const { billable, finalIssue } = await verifyFitmentFields(tx, actor, fitmentId, payload);
        Object.assign(data, { verifiedAt: now, verifiedById: actor.id, billable });
        Object.assign(extraEventData, { finalIssue, billable });
        break;
      }
      case 'APPROVE':
        Object.assign(data, { approvedAt: now, approvedById: actor.id });
        break;
      case 'REOPEN':
        // The history keeps the earlier verification and approval; the fitment starts a new cycle.
        Object.assign(data, {
          reopenCount: { increment: 1 },
          lastReopenReason: payload.reason,
          lastReopenedAt: now,
          lastReopenedById: actor.id,
          verifiedAt: null,
          verifiedById: null,
          approvedAt: null,
          approvedById: null,
          // F06: billable is decided again at the next verification; the verification fields are kept.
          billable: null,
        });
        break;
      case 'UNDO_FAULTY':
        // Back to Assigned with the same technician (D-257); the form and photos are kept.
        Object.assign(data, { faultyAt: null, faultReason: null });
        break;
    }
    await tx.fitment.update({ where: { id: fitmentId }, data });

    const eventData: Record<string, unknown> = {
      tkId,
      ...cleanPayload(payload),
      ...extraEventData,
      ...(opts.simulated && { simulated: true }),
    };
    const attributions = action === 'REOPEN' ? await reopenAttributions(tx, actor, fitment) : [];
    if (attributions.length) eventData.attributions = attributions;
    const replacement = action === 'MARK_FAULTY' ? await createReplacement(tx, fitment) : null;
    if (replacement) eventData.replacementTkId = formatTkId(replacement.tkNo);
    if (undone) eventData.replacementTkId = formatTkId(undone.tkNo);

    const event = await writeEvent(tx, actor, {
      taskId: fitment.taskId,
      fitmentId,
      type: FITMENT_ACTION_EVENTS[action],
      fromStatus: fitment.status,
      toStatus,
      data: eventData as Prisma.InputJsonValue,
    });
    if (attributions.length) {
      await tx.reopenAttribution.createMany({
        data: attributions.map((a) => ({ eventId: event.id, fitmentId, userId: a.userId, role: a.role })),
      });
    }
    if (replacement) {
      await writeEvent(tx, actor, {
        taskId: fitment.taskId,
        fitmentId: replacement.id,
        type: 'FITMENT_REPLACEMENT_CREATED',
        toStatus: replacement.status,
        data: {
          tkId: formatTkId(replacement.tkNo),
          replacementOf: tkId,
          reason: payload.reason ?? null,
          ...(opts.simulated && { simulated: true }),
        },
      });
    }
    if (undone) {
      // The replacement is no longer needed: Closed – not done with the system reason, the undo reason as comments.
      // It is unlinked (`replacementOfId` is unique), so a later MARK_FAULTY can create a new replacement; its
      // events keep the link (FITMENT_REPLACEMENT_CREATED.replacementOf, FITMENT_CLOSED_NOT_DONE.faultUndoneOf).
      const closeReason = await faultUndoneCloseReason(tx);
      await tx.fitment.update({
        where: { id: undone.id },
        data: {
          status: 'CLOSED_NOT_DONE',
          closedAt: now,
          closeReasonId: closeReason.id,
          closeComments: payload.reason ?? null,
          replacementOfId: null,
        },
      });
      await writeEvent(tx, actor, {
        taskId: fitment.taskId,
        fitmentId: undone.id,
        type: 'FITMENT_CLOSED_NOT_DONE',
        fromStatus: undone.status,
        toStatus: 'CLOSED_NOT_DONE',
        data: {
          tkId: formatTkId(undone.tkNo),
          reason: closeReason.name,
          comments: payload.reason ?? null,
          faultUndoneOf: tkId,
          ...(opts.simulated && { simulated: true }),
        },
      });
    }
    if (opts.afterApply) await opts.afterApply(tx, { id: fitmentId, taskId: fitment.taskId, tkId });
    await recomputeTaskStatus(tx, fitment.taskId);
  });

  return transitionResult(fitmentId, opts.viewer ?? actor);
}

/**
 * Who a reopen counts against (D-074): an OE reopen → the technician; an OM/SA reopen of an OE-verified
 * fitment → the task's OE and the technician; any other OM/SA reopen → the technician. A missing person is
 * skipped.
 */
async function reopenAttributions(
  tx: Tx,
  actor: User,
  fitment: { status: string; technicianId: string | null; task: { oeId: string } },
): Promise<{ userId: string; role: Role }[]> {
  const rows: { userId: string; role: Role }[] = [];
  const managerReopen = actor.role === 'SUPER_ADMIN' || actor.role === 'OM';
  if (managerReopen && fitment.status === 'OE_VERIFIED') {
    const oe = await tx.user.findUnique({ where: { id: fitment.task.oeId }, select: { id: true } });
    if (oe) rows.push({ userId: oe.id, role: 'OE' });
  }
  if (fitment.technicianId) rows.push({ userId: fitment.technicianId, role: 'OT' });
  return rows;
}

/**
 * UNDO_FAULTY (D-257): the replacement of the faulty fitment, locked; refused with 409 unless it is still Open or
 * Assigned (not started).
 */
async function lockUnstartedReplacement(tx: Tx, fitment: { id: string; tkNo: number }) {
  const replacement = await tx.fitment.findFirst({ where: { replacementOfId: fitment.id }, select: { id: true } });
  if (!replacement) return null;
  await tx.$queryRaw`SELECT "id" FROM "Fitment" WHERE "id" = ${replacement.id} FOR UPDATE`;
  const row = await tx.fitment.findUniqueOrThrow({ where: { id: replacement.id }, select: { id: true, tkNo: true, status: true } });
  if (row.status !== 'OPEN' && row.status !== 'ASSIGNED') {
    throw conflict(
      'INVALID_TRANSITION',
      `${formatTkId(row.tkNo)} (the replacement) is already ${row.status === 'IN_PROGRESS' ? 'in progress' : FITMENT_STATUS_LABELS[row.status]}; the fault marking of ${formatTkId(fitment.tkNo)} can only be undone while its replacement is Open or Assigned`,
    );
  }
  return row;
}

/**
 * The built-in close reason "Faulty marked by mistake" (CR-11; created by the migration and the seed), found by
 * its code, or created when missing (e.g. a test database whose lookups were truncated).
 */
async function faultUndoneCloseReason(tx: Tx) {
  const { name, code } = FAULT_UNDONE_CLOSE_REASON;
  const select = { id: true, name: true } as const;
  const existing = await tx.lookupItem.findUnique({ where: { kind_code: { kind: 'CLOSE_REASON', code } }, select });
  if (existing) return existing;
  // A same-named entry someone added by hand becomes the built-in one (as in the migration).
  const nameKey = toNameKey(name);
  return tx.lookupItem.upsert({
    where: { kind_nameKey: { kind: 'CLOSE_REASON', nameKey } },
    create: { kind: 'CLOSE_REASON', name, nameKey, code, isSystem: true, active: true, sortOrder: 1000 },
    update: { name, code, isSystem: true, active: true },
    select,
  });
}

/** The replacement of a fitment moved to FT (D-012): same task and vehicle, a new TK number, Open, unassigned. */
async function createReplacement(
  tx: Tx,
  original: { id: string; taskId: string; vehicleRegNo: string | null; chassisNo: string | null; assetNumber: string | null; oldDeviceId: string | null },
) {
  const last = await tx.fitment.aggregate({ where: { taskId: original.taskId }, _max: { seq: true } });
  return tx.fitment.create({
    data: {
      taskId: original.taskId,
      tkNo: await nextNumber(tx, 'TK'),
      seq: (last._max.seq ?? 0) + 1,
      status: 'OPEN',
      technicianId: null,
      vehicleRegNo: original.vehicleRegNo,
      chassisNo: original.chassisNo,
      assetNumber: original.assetNumber,
      oldDeviceId: original.oldDeviceId,
      replacementOfId: original.id,
    },
  });
}

/** The fitment as the viewer sees it, plus a summary of its task. */
async function transitionResult(fitmentId: string, viewer: User): Promise<TransitionResponse> {
  const fitment = await prisma.fitment.findUniqueOrThrow({
    where: { id: fitmentId },
    include: {
      ...fitmentInclude,
      task: { select: { id: true, omNo: true, oeId: true, status: true, fitments: { select: { status: true, technicianId: true } } } },
    },
  });
  const { task } = fitment;
  return {
    fitment: toFitmentDto(fitment, task, viewer),
    task: { id: task.id, omId: formatOmId(task.omNo), status: task.status, counts: countFitments(task.fitments) },
  };
}

/**
 * Bulk final approve (OM/SA, ≤ 200): each fitment in its own transaction, so one refusal doesn't block the
 * rest. Returns the approved TK ids and, for the others, the error code and message.
 */
export async function approveMany(actor: User, fitmentIds: string[]): Promise<ApproveFitmentsResponse> {
  if (!canApproveFitments(actor)) throw forbidden();
  const ids = [...new Set(fitmentIds)];
  const rows = await prisma.fitment.findMany({ where: { id: { in: ids } }, select: { id: true, tkNo: true } });
  const tkIds = new Map(rows.map((r) => [r.id, formatTkId(r.tkNo)]));
  const result: ApproveFitmentsResponse = { approved: [], failed: [] };
  for (const id of ids) {
    const tkId = tkIds.get(id) ?? id;
    try {
      await transitionFitment(actor, id, 'APPROVE');
      result.approved.push(tkId);
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      result.failed.push({ tkId, code: err.code, message: err.message });
    }
  }
  return result;
}
