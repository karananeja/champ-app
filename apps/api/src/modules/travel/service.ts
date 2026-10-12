import {
  TRAVEL_ACTION_EVENTS,
  TRAVEL_NOT_ALLOWED,
  TRAVEL_TRANSITIONS,
  canEditTravel,
  canPerformTravel,
  canRaiseTravel,
  canTransitionTravel,
  formatTkId,
  formatTtId,
  isInTravelScope,
  travelLockedMessage,
  travelSourceFor,
  travelTransitionRefusal,
  type CreateTravelInput,
  type ListTravelQuery,
  type Paginated,
  type TravelChangesInput,
  type TravelOptionsResponse,
  type TravelTaskDto,
  type TravelTaskListItemDto,
  type TravelTransitionInput,
} from '@champ/shared';
import type { Prisma } from '../../generated/prisma/client';
import { nextNumber } from '../../lib/counters';
import { conflict, forbidden, notFound } from '../../lib/errors';
import { prisma, type User } from '../../lib/prisma';
import type { Storage } from '../../lib/storage';
import { notifyTravel } from '../notifications/notifier';
import { diffOf, type Diff } from '../tasks/events';
import { dateOfDay, dayOf, distanceOf, toTravelDto, toTravelListItem, travelDetailInclude, travelListInclude } from './dto';
import { travelOrderBy, travelWhere } from './filters';
import { validateTravelRefs, type TravelRefNames, type TravelRefValues } from './refs';

type Tx = Prisma.TransactionClient;

/** A TT with what the rules and the detail need, or 404. */
export async function loadTravel(id: string, db: Tx = prisma) {
  const tt = await db.travelTask.findUnique({ where: { id }, include: travelDetailInclude });
  if (!tt) throw notFound('Travel task not found');
  return tt;
}
type LoadedTravel = Awaited<ReturnType<typeof loadTravel>>;

/** Locks the TT row for the rest of the transaction (edits, transitions and receipts run one at a time). */
export async function lockTravel(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "TravelTask" WHERE "id" = ${id} FOR UPDATE`;
}

const outOfScope = (actor: User) =>
  forbidden(
    'FORBIDDEN',
    actor.role === 'OT' ? 'You can only change your own travel tasks' : 'You can only change travel tasks of your own technicians',
  );

/** A TT the actor may change: 404 when missing, 403 when it isn't in their scope (spec §2 `travelScope`). */
export async function loadTravelForChange(actor: User, id: string, db: Tx = prisma): Promise<LoadedTravel> {
  const tt = await loadTravel(id, db);
  if (!isInTravelScope(actor, tt.technician)) throw outOfScope(actor);
  return tt;
}

/** Edits are refused with 403 for someone who never may, and 409 TRAVEL_LOCKED when the status locks them. */
function assertEditable(actor: User, tt: LoadedTravel) {
  if (canEditTravel(actor, tt)) return;
  if (actor.role === 'OM' || tt.raisedById === actor.id) throw conflict('TRAVEL_LOCKED', travelLockedMessage(formatTtId(tt.ttNo), tt.status));
  throw forbidden('FORBIDDEN', 'Only the person who raised this travel task or an operations manager can edit it');
}

const raiseRefusal = (actor: User) =>
  forbidden(
    'FORBIDDEN',
    actor.role === 'OT'
      ? 'A technician can only raise their own travel tasks'
      : 'An operation executive can only raise travel tasks for their own technicians',
  );

// --- Read ---

/** `GET /travel-tasks/:id`: 404 when it doesn't exist or isn't in the caller's scope. */
export async function getTravel(storage: Storage, actor: User, id: string): Promise<TravelTaskDto> {
  const tt = await loadTravel(id);
  if (!isInTravelScope(actor, tt.technician)) throw notFound('Travel task not found');
  return toTravelDto(storage, tt, actor);
}

export async function listTravel(actor: User, query: ListTravelQuery): Promise<Paginated<TravelTaskListItemDto>> {
  const where = travelWhere(actor, query);
  // Not a batch transaction (D-071).
  const [total, rows] = await Promise.all([
    prisma.travelTask.count({ where }),
    prisma.travelTask.findMany({
      where,
      include: travelListInclude,
      orderBy: travelOrderBy(query),
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return { items: rows.map(toTravelListItem), total, page: query.page, pageSize: query.pageSize };
}

/** `GET /travel-tasks/options`: the active technicians the caller may raise for (an OE: their own; an OT: themselves). */
export async function getTravelOptions(actor: User): Promise<TravelOptionsResponse> {
  const scope: Prisma.UserWhereInput = actor.role === 'OE' ? { managerId: actor.id } : actor.role === 'OT' ? { id: actor.id } : {};
  const technicians = await prisma.user.findMany({
    where: { role: 'OT', status: 'ACTIVE', ...scope },
    select: { id: true, name: true, technicianType: true, baseLocation: { select: { city: true } } },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });
  return {
    technicians: technicians.map((t) => ({ id: t.id, name: t.name, technicianType: t.technicianType, baseLocation: t.baseLocation?.city ?? null })),
  };
}

// --- Create ---

/**
 * `POST /travel-tasks`: validates the references, then who may raise for this technician (an OE only for their
 * own technicians, an OT only for themselves), and creates TT-0000n (Counter 'TT') with a TT_RAISED event.
 * Source: MOBILE for an OT, WEB otherwise.
 */
export async function createTravel(storage: Storage, actor: User, input: CreateTravelInput): Promise<TravelTaskDto> {
  const values: TravelRefValues = {
    technicianId: input.technicianId,
    locationId: input.locationId,
    clientId: input.clientId ?? null,
    relatedFitmentId: input.relatedFitmentId ?? null,
  };
  const { technician } = await validateTravelRefs(values);
  if (!canRaiseTravel(actor, technician)) throw raiseRefusal(actor);

  const id = await prisma.$transaction(async (tx) => {
    const ttNo = await nextNumber(tx, 'TT');
    const created = await tx.travelTask.create({
      data: {
        ttNo,
        ...values,
        purpose: input.purpose,
        travelDate: dateOfDay(input.travelDate),
        distanceKm: input.distanceKm ?? null,
        source: travelSourceFor(actor),
        raisedById: actor.id,
      },
    });
    await tx.travelTaskEvent.create({
      data: { travelTaskId: created.id, actorId: actor.id, type: 'TT_RAISED', toStatus: 'RAISED', data: { ttId: formatTtId(ttNo) } },
    });
    await notifyTravel(tx, actor, { type: 'TRAVEL_RAISED', travelTaskId: created.id });
    return created.id;
  });
  return getTravel(storage, actor, id);
}

// --- Edit ---

/** The readable values a diff compares (names instead of ids, D-103 style). */
function readable(tt: { purpose: string; travelDate: Date; distanceKm: Prisma.Decimal | number | null }, names: TravelRefNames) {
  return {
    technician: names.technician,
    location: names.location,
    customer: names.customer,
    purpose: tt.purpose,
    travelDate: dayOf(tt.travelDate),
    relatedTask: names.relatedTask,
    distanceKm: tt.distanceKm === null ? null : Number(tt.distanceKm),
  };
}

const namesOf = (tt: LoadedTravel): TravelRefNames => ({
  technician: tt.technician.name,
  location: tt.location.city,
  customer: tt.client?.name ?? null,
  relatedTask: tt.relatedFitment ? formatTkId(tt.relatedFitment.tkNo) : null,
});

/**
 * Applies `changes` to a locked TT inside `tx`: validates changed references (and, when the technician changes,
 * that the actor may raise for the new one), updates the row and returns the readable diff (empty when nothing
 * changed). Used by PATCH and by RESUBMIT with changes.
 */
async function applyChanges(tx: Tx, actor: User, tt: LoadedTravel, changes: TravelChangesInput): Promise<Diff> {
  const previous: TravelRefValues = {
    technicianId: tt.technicianId,
    locationId: tt.locationId,
    clientId: tt.clientId,
    relatedFitmentId: tt.relatedFitmentId,
  };
  const values: TravelRefValues = {
    technicianId: changes.technicianId ?? previous.technicianId,
    locationId: changes.locationId ?? previous.locationId,
    clientId: changes.clientId === undefined ? previous.clientId : changes.clientId,
    relatedFitmentId: changes.relatedFitmentId === undefined ? previous.relatedFitmentId : changes.relatedFitmentId,
  };
  const { technician, names } = await validateTravelRefs(values, previous);
  if (values.technicianId !== previous.technicianId && !canRaiseTravel(actor, technician)) throw raiseRefusal(actor);

  const next = {
    purpose: changes.purpose ?? tt.purpose,
    travelDate: changes.travelDate ? dateOfDay(changes.travelDate) : tt.travelDate,
    distanceKm: changes.distanceKm === undefined ? distanceOf(tt.distanceKm) : changes.distanceKm,
  };
  const diff = diffOf(readable(tt, namesOf(tt)), readable(next, names));
  if (Object.keys(diff).length > 0) await tx.travelTask.update({ where: { id: tt.id }, data: { ...values, ...next } });
  return diff;
}

/** `PATCH /travel-tasks/:id` (canEditTravel): a partial edit with a TT_UPDATED diff event (none when nothing changed). */
export async function updateTravel(storage: Storage, actor: User, id: string, changes: TravelChangesInput): Promise<TravelTaskDto> {
  await prisma.$transaction(async (tx) => {
    await lockTravel(tx, id);
    const tt = await loadTravelForChange(actor, id, tx);
    assertEditable(actor, tt);
    const diff = await applyChanges(tx, actor, tt, changes);
    if (Object.keys(diff).length > 0) {
      await tx.travelTaskEvent.create({
        data: { travelTaskId: id, actorId: actor.id, type: 'TT_UPDATED', data: { ttId: formatTtId(tt.ttNo), ...diff } as Prisma.InputJsonObject },
      });
    }
  });
  return getTravel(storage, actor, id);
}

// --- Transitions (D-120) ---

/**
 * `POST /travel-tasks/:id/transitions`: VERIFY (Raised → Verified), REJECT (Raised → Rejected, reason), RESUBMIT
 * (Rejected → Raised, with optional changes) and REOPEN (Verified → Raised, reason, OM only). Locks the row,
 * checks who (403) and the status (409 INVALID_TRANSITION), and guards the update on the status it read, so of
 * two concurrent verifies one wins and the other gets 409.
 */
export async function transitionTravel(storage: Storage, actor: User, id: string, input: TravelTransitionInput): Promise<TravelTaskDto> {
  const { action } = input;
  await prisma.$transaction(async (tx) => {
    await lockTravel(tx, id);
    const tt = await loadTravelForChange(actor, id, tx);
    const ttId = formatTtId(tt.ttNo);
    if (!canPerformTravel(action, actor, tt, tt.technician)) throw forbidden('FORBIDDEN', TRAVEL_NOT_ALLOWED[action]);
    if (!canTransitionTravel(action, tt.status)) throw conflict('INVALID_TRANSITION', travelTransitionRefusal(ttId, action, tt.status));

    const { from, to } = TRAVEL_TRANSITIONS[action];
    const now = new Date();
    const data: Prisma.TravelTaskUncheckedUpdateManyInput = { status: to };
    const eventData: Record<string, unknown> = { ttId };
    switch (input.action) {
      case 'VERIFY':
        Object.assign(data, { verifiedAt: now, verifiedById: actor.id });
        break;
      case 'REJECT':
        Object.assign(data, { rejectedAt: now, rejectedById: actor.id, rejectionReason: input.reason });
        eventData.reason = input.reason;
        break;
      case 'RESUBMIT':
        // The edits ride along in the same transaction; the rejection stays on the row and in the history.
        if (input.changes) Object.assign(eventData, await applyChanges(tx, actor, tt, input.changes));
        break;
      case 'REOPEN':
        // The history keeps the verification; the TT is Raised again until it is verified anew.
        Object.assign(data, { reopenedAt: now, reopenedById: actor.id, reopenReason: input.reason, verifiedAt: null, verifiedById: null });
        eventData.reason = input.reason;
        break;
    }
    const updated = await tx.travelTask.updateMany({ where: { id, status: from }, data });
    if (updated.count === 0) throw conflict('INVALID_TRANSITION', travelTransitionRefusal(ttId, action, tt.status));
    await tx.travelTaskEvent.create({
      data: {
        travelTaskId: id,
        actorId: actor.id,
        type: TRAVEL_ACTION_EVENTS[action],
        fromStatus: from,
        toStatus: to,
        data: eventData as Prisma.InputJsonObject,
      },
    });
    if (action === 'VERIFY') await notifyTravel(tx, actor, { type: 'TRAVEL_VERIFIED', travelTaskId: id });
  });
  return getTravel(storage, actor, id);
}
