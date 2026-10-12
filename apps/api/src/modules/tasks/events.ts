import type { TaskEventType } from '@champ/shared';
import type { Prisma } from '../../generated/prisma/client';
import { notifyForEvents } from '../notifications/notifier';

type Tx = Prisma.TransactionClient;

export interface EventInput {
  taskId: string;
  fitmentId?: string;
  type: TaskEventType;
  fromStatus?: string | null;
  toStatus?: string | null;
  data?: Prisma.InputJsonValue;
}

/**
 * Writes audit rows (TaskEvent) inside the mutation's transaction, and the in-app notifications they cause (F13),
 * so a rolled-back action notifies nobody.
 */
export async function writeEvents(tx: Tx, actor: { id: string }, events: EventInput[]) {
  if (events.length === 0) return;
  await tx.taskEvent.createMany({ data: events.map((e) => ({ ...e, actorId: actor.id })) });
  await notifyForEvents(tx, actor, events);
}

/** Writes one audit row (and its notifications) and returns it (when its id is needed, e.g. for reopen attributions). */
export async function writeEvent(tx: Tx, actor: { id: string }, event: EventInput) {
  const created = await tx.taskEvent.create({ data: { ...event, actorId: actor.id } });
  await notifyForEvents(tx, actor, [event]);
  return created;
}

export type Diff = Record<string, [unknown, unknown]>;
const comparable = (v: unknown) => (v instanceof Date ? v.toISOString() : (v ?? null));

/** `{ field: [before, after] }` for the fields of `next` whose value differs from `before`. */
export function diffOf(before: Record<string, unknown>, next: Record<string, unknown>): Diff {
  const diff: Diff = {};
  for (const [key, value] of Object.entries(next)) {
    if (comparable(before[key]) !== comparable(value)) diff[key] = [comparable(before[key]), comparable(value)];
  }
  return diff;
}
