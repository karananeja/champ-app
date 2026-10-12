import { defaultTaskSort, istDayStart, parseTaskId, type TaskFilters } from '@champ/shared';
import type { Prisma } from '../../generated/prisma/client';
import type { User } from '../../lib/prisma';

const DAY_MS = 24 * 3600 * 1000;
const contains = (q: string) => ({ contains: q, mode: 'insensitive' as const });

/** Search box: OM/OE/TK ids (or bare numbers), customer name or code, and POC name. */
function searchWhere(q: string): Prisma.TaskWhereInput {
  const or: Prisma.TaskWhereInput[] = [{ client: { name: contains(q) } }, { client: { code: contains(q) } }, { pocName: contains(q) }];
  const id = parseTaskId(q);
  if (id) {
    if (!id.prefix || id.prefix === 'OM') or.push({ omNo: id.number });
    if (!id.prefix || id.prefix === 'OE') or.push({ oeNo: id.number });
    if (!id.prefix || id.prefix === 'TK') or.push({ fitments: { some: { tkNo: id.number } } });
  }
  return { OR: or };
}

/**
 * The `where` of `GET /tasks` and `GET /tasks/export`. Deleted tasks are always left out. Views: open =
 * not completed; assigned = the caller is the task's OE; completed = status COMPLETED (CR-04); all =
 * everything. `from`/`to` are IST days on the fitment date, both inclusive.
 */
export function taskWhere(actor: User, filters: TaskFilters): Prisma.TaskWhereInput {
  const and: Prisma.TaskWhereInput[] = [{ deletedAt: null }];
  if (filters.view === 'open') and.push({ status: { not: 'COMPLETED' } });
  if (filters.view === 'assigned') and.push({ oeId: actor.id });
  if (filters.view === 'completed') and.push({ status: 'COMPLETED' });
  if (filters.q) and.push(searchWhere(filters.q));
  if (filters.clientId) and.push({ clientId: filters.clientId });
  if (filters.oeId) and.push({ oeId: filters.oeId });
  if (filters.technicianId) and.push({ fitments: { some: { technicianId: filters.technicianId } } });
  if (filters.status) and.push({ status: filters.status });
  if (filters.activityId) and.push({ activityId: filters.activityId });
  const from = filters.from ? istDayStart(filters.from) : null;
  const to = filters.to ? istDayStart(filters.to) : null;
  if (from) and.push({ fitmentAt: { gte: from } });
  if (to) and.push({ fitmentAt: { lt: new Date(to.getTime() + DAY_MS) } });
  return { AND: and };
}

/** The list order: the given sort, else the view's default (`defaultTaskSort`); ties by OM id. */
export function taskOrderBy(filters: Pick<TaskFilters, 'sort' | 'view'>): Prisma.TaskOrderByWithRelationInput[] {
  const sort = filters.sort ?? defaultTaskSort(filters.view);
  const [field, dir] = sort.split(':') as ['fitmentAt' | 'createdAt' | 'completedAt', 'asc' | 'desc'];
  // completedAt is null on tasks that aren't completed (All tasks view): keep those last either way.
  if (field === 'completedAt') return [{ completedAt: { sort: dir, nulls: 'last' } }, { omNo: dir }];
  return [{ [field]: dir }, { omNo: dir }];
}
