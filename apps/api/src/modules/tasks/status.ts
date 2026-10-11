import { deriveTaskStatus, isFitmentAssignable, type FitmentStatus, type TaskStatus } from '@champ/shared';
import type { Prisma } from '../../generated/prisma/client';
import { conflict } from '../../lib/errors';

/**
 * The single place that sets `Task.status` (spec §2): reads the task's fitments and stores the aggregate
 * (any Open → OPEN; all Assigned → ASSIGNED; all final → COMPLETED; otherwise IN_PROGRESS). F05 extends
 * the rule through `deriveTaskStatus`.
 */
export async function recomputeTaskStatus(tx: Prisma.TransactionClient, taskId: string): Promise<TaskStatus> {
  const fitments = await tx.fitment.findMany({ where: { taskId }, select: { status: true } });
  const status = deriveTaskStatus(fitments.map((f) => f.status));
  await tx.task.updateMany({ where: { id: taskId, NOT: { status } }, data: { status } });
  return status;
}

/** Status of a fitment given its technician: Assigned with one, Open without (F04 rules). */
export const assignmentStatus = (technicianId: string | null): FitmentStatus => (technicianId ? 'ASSIGNED' : 'OPEN');

/** Locks the task row for the rest of the transaction, so concurrent edits of one task run one at a time. */
export async function lockTask(tx: Prisma.TransactionClient, taskId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Task" WHERE "id" = ${taskId} FOR UPDATE`;
}

export const taskStarted = () =>
  conflict('TASK_STARTED', 'Work has started on this task, so it can no longer be edited or deleted.');

export const fitmentLocked = (tkId: string) =>
  conflict('FITMENT_LOCKED', `${tkId} has already started, so it can't be changed.`);

/** Throws 409 TASK_STARTED unless every fitment is still Open or Assigned (spec §2, "untouched"). */
export function assertUntouched(fitments: readonly { status: FitmentStatus }[]): void {
  if (!fitments.every((f) => isFitmentAssignable(f.status))) throw taskStarted();
}
