import {
  formatOmId,
  formatTkId,
  istDayStart,
  type Paginated,
  type WorkflowFitmentItemDto,
  type WorkflowListQuery,
} from '@champ/shared';
import type { Prisma } from '../../generated/prisma/client';
import { prisma, type User } from '../../lib/prisma';

const DAY_MS = 24 * 3600 * 1000;

/** The workflow lists: Awaiting approval (OE verified), Re-opened (reopened at least once) and Faulty (moved to FT). */
export type WorkflowList = 'awaiting-approval' | 'reopened' | 'faulty';

const LISTS: Record<
  WorkflowList,
  { where: (q: WorkflowListQuery) => Prisma.FitmentWhereInput; date: 'verifiedAt' | 'lastReopenedAt' | 'faultyAt'; dir: 'asc' | 'desc' }
> = {
  // Oldest verification first: the longest-waiting fitments come first.
  'awaiting-approval': { where: () => ({ status: 'OE_VERIFIED' }), date: 'verifiedAt', dir: 'asc' },
  reopened: {
    where: (q) => ({ reopenCount: { gt: 0 }, ...(q.current && { status: 'REOPENED' }) }),
    date: 'lastReopenedAt',
    dir: 'desc',
  },
  faulty: { where: () => ({ status: 'MOVED_TO_FT' }), date: 'faultyAt', dir: 'desc' },
};

const userRef = { select: { id: true, name: true } } as const;

const listInclude = {
  task: {
    select: {
      id: true,
      omNo: true,
      oe: userRef,
      client: { select: { id: true, name: true } },
      site: { select: { id: true, name: true } },
    },
  },
  technician: userRef,
  verifiedBy: userRef,
  lastReopenedBy: userRef,
  replacement: { select: { id: true, tkNo: true, status: true, technician: userRef } },
} satisfies Prisma.FitmentInclude;
type ListRow = Prisma.FitmentGetPayload<{ include: typeof listInclude }>;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function toItem(f: ListRow): WorkflowFitmentItemDto {
  return {
    id: f.id,
    tkId: formatTkId(f.tkNo),
    status: f.status,
    task: { id: f.task.id, omId: formatOmId(f.task.omNo) },
    client: f.task.client,
    site: f.task.site,
    technician: f.technician,
    oe: f.task.oe,
    vehicleRegNo: f.vehicleRegNo,
    verifiedAt: iso(f.verifiedAt),
    verifiedBy: f.verifiedBy,
    reopenCount: f.reopenCount,
    lastReopenReason: f.lastReopenReason,
    lastReopenedAt: iso(f.lastReopenedAt),
    lastReopenedBy: f.lastReopenedBy,
    faultReason: f.faultReason,
    faultyAt: iso(f.faultyAt),
    replacement: f.replacement && {
      id: f.replacement.id,
      tkId: formatTkId(f.replacement.tkNo),
      status: f.replacement.status,
      technician: f.replacement.technician,
    },
  };
}

/**
 * `GET /fitments/{awaiting-approval|reopened|faulty}`: fitments of tasks that aren't deleted; an OE sees only
 * their own tasks. Filters: customer, OE, technician and IST days on the list's date.
 */
export async function listWorkflowFitments(
  actor: User,
  list: WorkflowList,
  q: WorkflowListQuery,
): Promise<Paginated<WorkflowFitmentItemDto>> {
  const { where, date, dir } = LISTS[list];
  const and: Prisma.FitmentWhereInput[] = [{ task: { deletedAt: null } }, where(q)];
  if (actor.role === 'OE') and.push({ task: { oeId: actor.id } });
  if (q.clientId) and.push({ task: { clientId: q.clientId } });
  if (q.oeId) and.push({ task: { oeId: q.oeId } });
  if (q.technicianId) and.push({ technicianId: q.technicianId });
  const from = q.from ? istDayStart(q.from) : null;
  const to = q.to ? istDayStart(q.to) : null;
  if (from) and.push({ [date]: { gte: from } });
  if (to) and.push({ [date]: { lt: new Date(to.getTime() + DAY_MS) } });

  const filter: Prisma.FitmentWhereInput = { AND: and };
  const [total, rows] = await Promise.all([
    prisma.fitment.count({ where: filter }),
    prisma.fitment.findMany({
      where: filter,
      include: listInclude,
      orderBy: [{ [date]: dir }, { tkNo: dir }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  return { items: rows.map(toItem), total, page: q.page, pageSize: q.pageSize };
}
