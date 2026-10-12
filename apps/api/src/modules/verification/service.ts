import {
  VERIFICATION_FIELD_KEYS,
  VERIFICATION_FIELD_LABELS,
  canEditVerification,
  formatTkId,
  isPostApprovalEdit,
  isVerificationEditor,
  missingVerificationFields,
  verificationFieldMessage,
  verificationLockedMessage,
  type FitmentStatus,
  type FitmentVerificationDto,
  type LookupKind,
  type UpdateVerificationInput,
  type VerificationRequiredField,
} from '@champ/shared';
import type { Prisma } from '../../generated/prisma/client';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { prisma, type User } from '../../lib/prisma';
import { requireActiveLookup } from '../masters/refs';
import { writeEvent, type Diff } from '../tasks/events';
import { lockTask } from '../tasks/status';
import { toVerificationDto, verificationInclude } from './dto';

type Tx = Prisma.TransactionClient;

/** Statuses in which the verification has been given: a change of the final issue re-snapshots `billable` (D-101). */
const VERIFIED_STATUSES: readonly FitmentStatus[] = ['OE_VERIFIED', 'OM_APPROVED'];

/** The current verification of a fitment (names for the diff, ids for the comparison). */
const verificationState = {
  task: { select: { id: true, oeId: true, deletedAt: true } },
  issueObserved: { select: { name: true } },
  actionTaken: { select: { name: true } },
  finalIssue: { select: { name: true, billable: true } },
  accessories: { select: { accessory: { select: { id: true, name: true } } } },
} satisfies Prisma.FitmentInclude;
type FitmentState = Prisma.FitmentGetPayload<{ include: typeof verificationState }>;

/** The single-value references: input key, relation (for names), master kind and the diff key. */
const REFS = [
  { key: 'issueObservedId', rel: 'issueObserved', kind: 'ISSUE_OBSERVED', diffKey: 'issueObserved' },
  { key: 'actionTakenId', rel: 'actionTaken', kind: 'ACTION_TAKEN', diffKey: 'actionTaken' },
  { key: 'finalIssueId', rel: 'finalIssue', kind: 'FINAL_ISSUE', diffKey: 'finalIssue' },
] as const satisfies readonly { key: VerificationRequiredField; rel: string; kind: LookupKind; diffKey: string }[];

/**
 * 400 VERIFICATION_INCOMPLETE: `details.missing` lists the empty required fields with their labels, and
 * `details.fieldErrors` maps them to messages (so forms can show them inline).
 */
export function verificationIncomplete(missing: VerificationRequiredField[], message?: string) {
  const labels = missing.map((field) => VERIFICATION_FIELD_LABELS[field]);
  return badRequest('VERIFICATION_INCOMPLETE', message ?? `Fill in ${labels.join(', ')} before verifying`, {
    missing: missing.map((field) => ({ field, label: VERIFICATION_FIELD_LABELS[field] })),
    fieldErrors: Object.fromEntries(missing.map((field) => [field, [verificationFieldMessage(field)]])),
  });
}

/** Whether the input carries any verification field (VERIFY payloads may have none). */
export const hasVerificationFields = (input: UpdateVerificationInput) => VERIFICATION_FIELD_KEYS.some((key) => input[key] !== undefined);

/** Locks the task and the fitment row (the engine's order, D-080) and loads the fitment's verification. */
async function lockFitment(tx: Tx, fitmentId: string): Promise<FitmentState> {
  const located = await tx.fitment.findUnique({ where: { id: fitmentId }, select: { taskId: true } });
  if (!located) throw notFound('Fitment not found');
  await lockTask(tx, located.taskId);
  await tx.$queryRaw`SELECT "id" FROM "Fitment" WHERE "id" = ${fitmentId} FOR UPDATE`;
  const fitment = await tx.fitment.findUniqueOrThrow({ where: { id: fitmentId }, include: verificationState });
  if (fitment.task.deletedAt) throw notFound('Fitment not found');
  return fitment;
}

/**
 * Applies verification fields inside the caller's transaction. Changed references must be active and of the
 * right kind (an unchanged inactive value is kept); `accessoryIds` replaces the set. On a verified or approved
 * fitment the required fields can't be cleared, and a new final issue re-snapshots `billable` from its current
 * flag (D-101). Writes FITMENT_VERIFICATION_SAVED with the readable diff (and `postApproval`) when anything
 * changed. Returns the diff.
 */
export async function applyVerification(tx: Tx, actor: User, fitment: FitmentState, input: UpdateVerificationInput): Promise<Diff> {
  const next: Prisma.FitmentUncheckedUpdateInput = {};
  const diff: Diff = {};
  const merged: Record<VerificationRequiredField, string | null> = {
    issueObservedId: fitment.issueObservedId,
    actionTakenId: fitment.actionTakenId,
    finalIssueId: fitment.finalIssueId,
  };
  let finalIssueBillable: boolean | null | undefined;

  for (const { key, rel, kind, diffKey } of REFS) {
    const value = input[key];
    if (value === undefined || value === fitment[key]) continue;
    const item = value ? await requireActiveLookup(value, kind, key) : null;
    next[key] = value;
    merged[key] = value;
    diff[diffKey] = [fitment[rel]?.name ?? null, item?.name ?? null];
    if (key === 'finalIssueId') finalIssueBillable = item ? (item.billable ?? false) : null;
  }

  if (input.accessoryIds !== undefined) {
    const current = new Map(fitment.accessories.map(({ accessory }) => [accessory.id, accessory.name]));
    const ids = [...new Set(input.accessoryIds)];
    const changed = ids.length !== current.size || ids.some((id) => !current.has(id));
    if (changed) {
      const names = new Map(current);
      for (const id of ids) {
        if (!current.has(id)) names.set(id, (await requireActiveLookup(id, 'ACCESSORY', 'accessoryIds')).name);
      }
      const joined = (list: string[]) => (list.length ? list.sort((a, b) => a.localeCompare(b)).join(', ') : null);
      diff.accessories = [joined([...current.values()]), joined(ids.map((id) => names.get(id)!))];
      await tx.fitmentAccessory.deleteMany({ where: { fitmentId: fitment.id } });
      if (ids.length) await tx.fitmentAccessory.createMany({ data: ids.map((accessoryId) => ({ fitmentId: fitment.id, accessoryId })) });
    }
  }

  if (input.oeRemarks !== undefined && (input.oeRemarks ?? null) !== fitment.oeRemarks) {
    next.oeRemarks = input.oeRemarks ?? null;
    diff.oeRemarks = [fitment.oeRemarks, input.oeRemarks ?? null];
  }

  if (VERIFIED_STATUSES.includes(fitment.status)) {
    const missing = missingVerificationFields(merged);
    if (missing.length) {
      throw verificationIncomplete(
        missing,
        `${formatTkId(fitment.tkNo)} is verified, so ${missing.map((f) => VERIFICATION_FIELD_LABELS[f]).join(', ')} can't be left empty`,
      );
    }
    if (finalIssueBillable !== undefined && finalIssueBillable !== fitment.billable) {
      next.billable = finalIssueBillable;
      diff.billable = [fitment.billable, finalIssueBillable];
    }
  }

  if (Object.keys(diff).length === 0) return diff;
  await tx.fitment.update({
    where: { id: fitment.id },
    data: { ...next, verificationUpdatedAt: new Date(), verificationUpdatedById: actor.id },
  });
  const postApproval = isPostApprovalEdit(fitment.status);
  await writeEvent(tx, actor, {
    taskId: fitment.taskId,
    fitmentId: fitment.id,
    type: 'FITMENT_VERIFICATION_SAVED',
    data: { tkId: formatTkId(fitment.tkNo), ...diff, ...(postApproval && { postApproval: true }) } as Prisma.InputJsonValue,
  });
  return diff;
}

/**
 * The OE verification queue (F06): SUBMITTED fitments of the OE's own tasks that aren't deleted. Used by the
 * dashboard's "Awaiting my verification" count and the field app's Approve visit tile (F09).
 */
export function oeVerificationQueueWhere(actor: Pick<User, 'id'>): Prisma.FitmentWhereInput {
  return { status: 'SUBMITTED', task: { oeId: actor.id, deletedAt: null } };
}

/** 403 for people who never edit verifications; 409 FITMENT_LOCKED when the status no longer allows it. */
export function assertVerificationEditable(actor: User, fitment: { tkNo: number; status: FitmentStatus; task: { oeId: string } }, what: 'verification' | 'photos') {
  const ctx = { task: fitment.task, fitment: { technicianId: null, status: fitment.status } };
  if (canEditVerification(actor, ctx)) return;
  if (!isVerificationEditor(actor, ctx)) {
    throw forbidden('FORBIDDEN', `Only an operations manager or the task's operation executive can change the ${what}`);
  }
  throw conflict('FITMENT_LOCKED', verificationLockedMessage(formatTkId(fitment.tkNo), fitment.status, what));
}

/** `PUT /fitments/:fid/verification`: a draft save under the edit locks (spec §3–4). */
export async function saveVerification(actor: User, fitmentId: string, input: UpdateVerificationInput): Promise<FitmentVerificationDto> {
  await prisma.$transaction(async (tx) => {
    const fitment = await lockFitment(tx, fitmentId);
    assertVerificationEditable(actor, fitment, 'verification');
    await applyVerification(tx, actor, fitment, input);
  });
  return toVerificationDto(await prisma.fitment.findUniqueOrThrow({ where: { id: fitmentId }, include: verificationInclude }));
}

/**
 * The VERIFY step's verification part, inside the engine's transaction (after its actor and status checks):
 * saves inline fields first, then refuses with 400 VERIFICATION_INCOMPLETE if a required field is empty.
 * Returns the billable snapshot from the final issue's current flag and the final issue's name.
 */
export async function verifyFitmentFields(
  tx: Tx,
  actor: User,
  fitmentId: string,
  input: UpdateVerificationInput,
): Promise<{ billable: boolean; finalIssue: string }> {
  let fitment = await tx.fitment.findUniqueOrThrow({ where: { id: fitmentId }, include: verificationState });
  if (hasVerificationFields(input)) {
    await applyVerification(tx, actor, fitment, input);
    fitment = await tx.fitment.findUniqueOrThrow({ where: { id: fitmentId }, include: verificationState });
  }
  const missing = missingVerificationFields(fitment);
  if (missing.length) throw verificationIncomplete(missing);
  return { billable: fitment.finalIssue!.billable ?? false, finalIssue: fitment.finalIssue!.name };
}
