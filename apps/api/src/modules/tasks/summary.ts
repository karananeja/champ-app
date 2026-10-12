import type { DashboardSummaryDto } from '@champ/shared';
import { prisma, type User } from '../../lib/prisma';
import { travelWhere } from '../travel/filters';
import { oeVerificationQueueWhere } from '../verification/service';
import { workflowWhere } from '../workflow/lists';
import { taskWhere } from './filters';

/**
 * `GET /tasks/summary` (CR-03): the dashboard counts for the caller's role. Each count uses the same `where` as
 * the list its card links to (`taskWhere` for task views, `workflowWhere` for fitment lists), so they match and
 * keep the lists' scoping (an OE's fitment lists cover their own tasks only). F08 adds `travelToVerify` for OM and
 * OE (`travelWhere`, the Travel tasks list filtered to Raised).
 */
export async function getTaskSummary(actor: User): Promise<DashboardSummaryDto> {
  const tasks = (view: 'open' | 'completed' | 'assigned') => prisma.task.count({ where: taskWhere(actor, { view }) });
  const manager = actor.role === 'SUPER_ADMIN' || actor.role === 'OM';
  const oe = actor.role === 'OE';

  const [openTasks, completedTasks, awaitingApproval, reopened, faulty, assignedToMe, awaitingMyVerification, travelToVerify] = await Promise.all([
    tasks('open'),
    tasks('completed'),
    manager ? prisma.fitment.count({ where: workflowWhere(actor, 'awaiting-approval') }) : undefined,
    manager || oe ? prisma.fitment.count({ where: workflowWhere(actor, 'reopened') }) : undefined,
    manager || oe ? prisma.fitment.count({ where: workflowWhere(actor, 'faulty') }) : undefined,
    oe ? tasks('assigned') : undefined,
    oe ? prisma.fitment.count({ where: oeVerificationQueueWhere(actor) }) : undefined,
    // F08: Raised TTs, through the travel list's own scope (OM: all; OE: their technicians').
    actor.role === 'OM' || oe ? prisma.travelTask.count({ where: travelWhere(actor, { status: 'RAISED' }) }) : undefined,
  ]);
  return {
    openTasks,
    completedTasks,
    ...(awaitingApproval !== undefined && { awaitingApproval }),
    ...(reopened !== undefined && { reopened }),
    ...(faulty !== undefined && { faulty }),
    ...(assignedToMe !== undefined && { assignedToMe }),
    ...(awaitingMyVerification !== undefined && { awaitingMyVerification }),
    ...(travelToVerify !== undefined && { travelToVerify }),
  };
}
