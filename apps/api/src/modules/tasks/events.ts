import type { TaskEventType } from '@champ/shared';
import type { Prisma } from '../../generated/prisma/client';

type Tx = Prisma.TransactionClient;

export interface EventInput {
  taskId: string;
  fitmentId?: string;
  type: TaskEventType;
  fromStatus?: string | null;
  toStatus?: string | null;
  data?: Prisma.InputJsonValue;
}

/** Writes audit rows (TaskEvent) inside the mutation's transaction. */
export async function writeEvents(tx: Tx, actor: { id: string }, events: EventInput[]) {
  if (events.length === 0) return;
  await tx.taskEvent.createMany({ data: events.map((e) => ({ ...e, actorId: actor.id })) });
}

/** Writes one audit row and returns it (when its id is needed, e.g. for reopen attributions). */
export const writeEvent = (tx: Tx, actor: { id: string }, event: EventInput) =>
  tx.taskEvent.create({ data: { ...event, actorId: actor.id } });

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
