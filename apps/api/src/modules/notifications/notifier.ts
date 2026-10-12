import { NOTIFICATION_GROUP_WINDOW_MS, formatOmId, formatTkId, formatTtId, type TaskEventType } from '@champ/shared';
import type { Prisma } from '../../generated/prisma/client';
import { fitmentTitle, replacementBody, taskContext, travelTitle, type FitmentNotificationType } from './texts';

type Tx = Prisma.TransactionClient;

/** The Postgres channel the Socket.IO hub listens on (D-230); payloads are `NotifyPayload` JSON. */
export const NOTIFICATION_CHANNEL = 'champ_notifications';
export type NotifyPayload = { userId: string; notificationId: string } | { userId: string; unreadCount: number };

/** Sends a hub message; Postgres delivers it only when the surrounding transaction commits. */
export async function pgNotify(db: Pick<Tx, '$executeRaw'>, payload: NotifyPayload) {
  await db.$executeRaw`SELECT pg_notify(${NOTIFICATION_CHANNEL}, ${JSON.stringify(payload)})`;
}

/** The TaskEvent fields the notifier reads (a subset of `EventInput`). */
export interface NotifiableEvent {
  taskId: string;
  fitmentId?: string;
  type: TaskEventType;
  data?: unknown;
}

const SOURCES: Partial<Record<TaskEventType, true>> = {
  FITMENT_ASSIGNED: true,
  FITMENT_UNASSIGNED: true,
  FITMENT_SUBMITTED: true,
  FITMENT_VERIFIED: true,
  FITMENT_APPROVED: true,
  FITMENT_REOPENED: true,
  FITMENT_MARKED_FAULTY: true,
};

interface Draft {
  userId: string;
  type: FitmentNotificationType;
  taskId: string;
  fitmentIds: string[];
  /** Reopen reason, or the replacement TK ids (FT). */
  reason?: string;
  replacements: string[];
}

const dataOf = (e: NotifiableEvent) => (e.data && typeof e.data === 'object' ? (e.data as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

/**
 * Turns the TaskEvents a mutation just wrote into notifications (F13, D-228, D-229), inside the same transaction:
 * recipients per event type (never the actor, active users only), grouped per recipient, type, task and actor
 * within NOTIFICATION_GROUP_WINDOW_MS, and announced to the hub with pg_notify.
 */
export async function notifyForEvents(tx: Tx, actorRef: { id: string }, events: readonly NotifiableEvent[]) {
  // A task created with a technician assigns its fitments without FITMENT_ASSIGNED events (one TASK_CREATED).
  const created = events.filter((e) => e.type === 'TASK_CREATED' && str(dataOf(e).technicianId));
  const relevant = [...events.filter((e) => e.fitmentId && SOURCES[e.type]), ...created];
  if (relevant.length === 0) return;
  const actor = await tx.user.findUnique({ where: { id: actorRef.id }, select: { id: true, name: true, role: true } });
  if (!actor) return;

  // Sequential: a transaction runs on one connection.
  const tasks = await tx.task.findMany({
    where: { id: { in: [...new Set(relevant.map((e) => e.taskId))] } },
    select: { id: true, omNo: true, oeId: true, fitmentAt: true, client: { select: { name: true } }, site: { select: { name: true } } },
  });
  const fitments = await tx.fitment.findMany({
    where: { OR: [{ id: { in: relevant.flatMap((e) => (e.fitmentId ? [e.fitmentId] : [])) } }, { taskId: { in: created.map((e) => e.taskId) } }] },
    select: { id: true, taskId: true, tkNo: true, technicianId: true },
  });
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const fitmentById = new Map(fitments.map((f) => [f.id, f]));
  const managerRole = actor.role === 'OM' || actor.role === 'SUPER_ADMIN';

  const verifiers = new Map<string, string[]>();
  /** The OE's manager when an active OM, else all active OMs. */
  const verifiedRecipients = async (oeId: string) => {
    if (!verifiers.has(oeId)) {
      const oe = await tx.user.findUnique({ where: { id: oeId }, select: { manager: { select: { id: true, role: true, status: true } } } });
      const m = oe?.manager;
      const ids =
        m && m.role === 'OM' && m.status === 'ACTIVE'
          ? [m.id]
          : (await tx.user.findMany({ where: { role: 'OM', status: 'ACTIVE' }, select: { id: true } })).map((u) => u.id);
      verifiers.set(oeId, ids);
    }
    return verifiers.get(oeId)!;
  };

  const drafts = new Map<string, Draft>();
  const add = (userId: string | null | undefined, type: FitmentNotificationType, e: NotifiableEvent, extra: { reason?: string; replacement?: string } = {}) => {
    if (!userId || userId === actor.id) return;
    const key = `${userId}|${type}|${e.taskId}`;
    const draft = drafts.get(key) ?? { userId, type, taskId: e.taskId, fitmentIds: [], replacements: [] };
    if (!draft.fitmentIds.includes(e.fitmentId!)) draft.fitmentIds.push(e.fitmentId!);
    if (extra.reason) draft.reason = extra.reason;
    if (extra.replacement) draft.replacements.push(extra.replacement);
    drafts.set(key, draft);
  };

  for (const e of created) {
    for (const f of fitments) if (f.taskId === e.taskId) add(str(dataOf(e).technicianId), 'FITMENT_ASSIGNED', { ...e, fitmentId: f.id });
  }
  for (const e of relevant) {
    const task = taskById.get(e.taskId);
    const fitment = fitmentById.get(e.fitmentId ?? '');
    if (!task || !fitment) continue;
    const data = dataOf(e);
    switch (e.type) {
      case 'FITMENT_ASSIGNED':
      case 'FITMENT_UNASSIGNED': {
        const next = str(data.technicianId);
        const previous = str(data.previousTechnicianId);
        if (next) add(next, 'FITMENT_ASSIGNED', e);
        if (previous && previous !== next) add(previous, 'FITMENT_UNASSIGNED', e);
        break;
      }
      case 'FITMENT_SUBMITTED':
        add(task.oeId, 'FITMENT_SUBMITTED', e);
        break;
      case 'FITMENT_VERIFIED':
        for (const id of await verifiedRecipients(task.oeId)) add(id, 'FITMENT_VERIFIED', e);
        break;
      case 'FITMENT_APPROVED':
        add(fitment.technicianId, 'FITMENT_APPROVED', e);
        add(task.oeId, 'FITMENT_APPROVED', e);
        break;
      case 'FITMENT_REOPENED': {
        const reason = str(data.reason) ?? undefined;
        add(fitment.technicianId, 'FITMENT_REOPENED', e, { reason });
        if (managerRole) add(task.oeId, 'FITMENT_REOPENED', e, { reason });
        break;
      }
      case 'FITMENT_MARKED_FAULTY':
        add(task.oeId, 'FITMENT_MOVED_TO_FT', e, { replacement: str(data.replacementTkId) ?? undefined });
        break;
    }
  }
  if (drafts.size === 0) return;

  const active = new Set(
    (
      await tx.user.findMany({ where: { id: { in: [...new Set([...drafts.values()].map((d) => d.userId))] }, status: 'ACTIVE' }, select: { id: true } })
    ).map((u) => u.id),
  );
  for (const draft of drafts.values()) {
    if (!active.has(draft.userId)) continue;
    const task = taskById.get(draft.taskId)!;
    const firstTk = formatTkId(fitmentById.get(draft.fitmentIds[0]!)!.tkNo);
    await deliverFitment(tx, actor, draft, task, firstTk);
  }
}

const TK_PATTERN = /TK-\d+/g;

function bodyFor(draft: Draft, task: { client: { name: string }; site: { name: string }; fitmentAt: Date }, previousBody: string | null): string | null {
  const context = { clientName: task.client.name, siteName: task.site.name, fitmentAt: task.fitmentAt };
  switch (draft.type) {
    case 'FITMENT_ASSIGNED':
      return taskContext(context, true);
    case 'FITMENT_REOPENED':
      return draft.reason ?? previousBody;
    case 'FITMENT_MOVED_TO_FT': {
      const ids = [...new Set([...(previousBody?.match(TK_PATTERN) ?? []), ...draft.replacements])];
      return ids.length ? replacementBody(ids) : taskContext(context, false);
    }
    default:
      return taskContext(context, false);
  }
}

/** Groups into the recipient's unread notification of the same key within the window (row locked), or inserts. */
async function deliverFitment(
  tx: Tx,
  actor: { id: string; name: string },
  draft: Draft,
  task: { id: string; omNo: number; client: { name: string }; site: { name: string }; fitmentAt: Date },
  firstTk: string,
) {
  const groupKey = `${draft.type}:${draft.taskId}:${actor.id}`;
  // Serialises parallel transactions on the same recipient and key, so no count is lost and no twin row appears.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${draft.userId}|${groupKey}`}))`;
  const since = new Date(Date.now() - NOTIFICATION_GROUP_WINDOW_MS);
  const [existing] = await tx.$queryRaw<{ id: string; fitmentIds: string[]; body: string | null }[]>`
    SELECT "id", "fitmentIds", "body" FROM "Notification"
    WHERE "userId" = ${draft.userId} AND "groupKey" = ${groupKey} AND "readAt" IS NULL AND "updatedAt" >= ${since}
    ORDER BY "updatedAt" DESC LIMIT 1 FOR UPDATE`;

  const fitmentIds = [...new Set([...(existing?.fitmentIds ?? []), ...draft.fitmentIds])];
  const title = fitmentTitle(draft.type, { count: fitmentIds.length, tkId: firstTk, omId: formatOmId(task.omNo), actorName: actor.name });
  const body = bodyFor(draft, task, existing?.body ?? null);
  const row = existing
    ? await tx.notification.update({ where: { id: existing.id }, data: { fitmentIds, count: fitmentIds.length, title, body }, select: { id: true } })
    : await tx.notification.create({
        data: { userId: draft.userId, type: draft.type, taskId: draft.taskId, fitmentIds, actorId: actor.id, title, body, count: fitmentIds.length, groupKey },
        select: { id: true },
      });
  await pgNotify(tx, { userId: draft.userId, notificationId: row.id });
}

/**
 * Travel notifications (F08 → F13): RAISED → whoever may verify it (the technician's OE, else every active OM),
 * VERIFIED → the person who raised it. Never the actor; inactive users are skipped.
 */
export async function notifyTravel(tx: Tx, actorRef: { id: string }, input: { type: 'TRAVEL_RAISED' | 'TRAVEL_VERIFIED'; travelTaskId: string }) {
  const actor = await tx.user.findUnique({ where: { id: actorRef.id }, select: { id: true, name: true } });
  const tt = await tx.travelTask.findUnique({
    where: { id: input.travelTaskId },
    select: {
      ttNo: true,
      raisedById: true,
      purpose: true,
      technician: { select: { name: true, manager: { select: { id: true, role: true, status: true } } } },
    },
  });
  if (!actor || !tt) return;
  let recipients: string[];
  if (input.type === 'TRAVEL_VERIFIED') recipients = [tt.raisedById];
  else {
    const m = tt.technician.manager;
    recipients =
      m && m.role === 'OE' && m.status === 'ACTIVE'
        ? [m.id]
        : (await tx.user.findMany({ where: { role: 'OM', status: 'ACTIVE' }, select: { id: true } })).map((u) => u.id);
  }
  const candidates = [...new Set(recipients)].filter((id) => id !== actor.id);
  if (candidates.length === 0) return;
  const active = await tx.user.findMany({ where: { id: { in: candidates }, status: 'ACTIVE' }, select: { id: true } });
  const title = travelTitle(input.type, formatTtId(tt.ttNo), actor.name);
  const body = `${tt.technician.name} · ${tt.purpose}`;
  for (const { id: userId } of active) {
    const row = await tx.notification.create({
      data: { userId, type: input.type, travelTaskId: input.travelTaskId, actorId: actor.id, title, body },
      select: { id: true },
    });
    await pgNotify(tx, { userId, notificationId: row.id });
  }
}
