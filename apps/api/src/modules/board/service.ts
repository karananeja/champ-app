import {
  BOARD_STATUSES,
  FINISHED_STATUSES,
  FINISHED_STATUS_TIMESTAMPS,
  FINISHED_WINDOW_DAYS,
  formatOeId,
  formatOmId,
  formatTkId,
  istDayStart,
  parseTaskId,
  type BoardCard,
  type BoardColumnDto,
  type BoardColumnQuery,
  type BoardQuery,
  type BoardResponse,
  type FitmentStatus,
} from '@champ/shared';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { prisma } from '../../lib/prisma';

const DAY_MS = 24 * 3600 * 1000;

/** The client the board reads through (tests pass one with query logging to count queries). */
export type BoardDb = Pick<PrismaClient, 'fitment'>;

type BoardFilters = Omit<BoardQuery, 'pageSize'>;

/** `q`: a TK, OM or OE id (a bare number matches any of the three); anything else matches nothing. */
function idWhere(q: string): Prisma.FitmentWhereInput {
  const id = parseTaskId(q);
  if (!id) return { id: { in: [] } };
  const or: Prisma.FitmentWhereInput[] = [];
  if (!id.prefix || id.prefix === 'TK') or.push({ tkNo: id.number });
  if (!id.prefix || id.prefix === 'OM') or.push({ task: { omNo: id.number } });
  if (!id.prefix || id.prefix === 'OE') or.push({ task: { oeNo: id.number } });
  return { OR: or };
}

/**
 * Which statuses are shown and how (D-111): without a fitment-date range, finished fitments count only when
 * their status timestamp is within the last 7 days; with a range, every status is shown as filtered.
 */
function statusWhere(filters: BoardFilters, now: Date, statuses: readonly FitmentStatus[]): Prisma.FitmentWhereInput {
  if (filters.from || filters.to) return { status: { in: [...statuses] } };
  const since = new Date(now.getTime() - FINISHED_WINDOW_DAYS * DAY_MS);
  const finished = statuses.filter((s) => (FINISHED_STATUSES as readonly FitmentStatus[]).includes(s));
  const open = statuses.filter((s) => !finished.includes(s));
  const or: Prisma.FitmentWhereInput[] = [];
  if (open.length) or.push({ status: { in: open } });
  for (const s of finished as (typeof FINISHED_STATUSES)[number][]) {
    or.push({ status: s, [FINISHED_STATUS_TIMESTAMPS[s]]: { gte: since } });
  }
  return { OR: or };
}

/**
 * The `where` of the board: fitments of tasks that aren't deleted, with the filters (customer, OE, technician,
 * activity, fitment date as IST days, id search) and the finished window, limited to `statuses`.
 */
export function boardWhere(filters: BoardFilters, statuses: readonly FitmentStatus[] = BOARD_STATUSES, now = new Date()): Prisma.FitmentWhereInput {
  const and: Prisma.FitmentWhereInput[] = [{ task: { deletedAt: null } }, statusWhere(filters, now, statuses)];
  if (filters.clientId) and.push({ task: { clientId: filters.clientId } });
  if (filters.oeId) and.push({ task: { oeId: filters.oeId } });
  if (filters.activityId) and.push({ task: { activityId: filters.activityId } });
  if (filters.technicianId) and.push({ technicianId: filters.technicianId });
  if (filters.q) and.push(idWhere(filters.q));
  const from = filters.from ? istDayStart(filters.from) : null;
  const to = filters.to ? istDayStart(filters.to) : null;
  if (from) and.push({ task: { fitmentAt: { gte: from } } });
  if (to) and.push({ task: { fitmentAt: { lt: new Date(to.getTime() + DAY_MS) } } });
  return { AND: and };
}

const cardInclude = {
  task: {
    select: {
      id: true,
      omNo: true,
      oeNo: true,
      fitmentAt: true,
      client: { select: { id: true, name: true } },
      location: { select: { city: true } },
      activity: { select: { id: true, name: true } },
    },
  },
  technician: { select: { id: true, name: true } },
  replacementOf: { select: { id: true, tkNo: true } },
} satisfies Prisma.FitmentInclude;
type CardRow = Prisma.FitmentGetPayload<{ include: typeof cardInclude }>;

/** Soonest fitment first, then TK number (D-110). */
const cardOrder: Prisma.FitmentOrderByWithRelationInput[] = [{ task: { fitmentAt: 'asc' } }, { tkNo: 'asc' }];

function toCard(f: CardRow): BoardCard {
  return {
    id: f.id,
    tkId: formatTkId(f.tkNo),
    status: f.status,
    task: { id: f.task.id, omId: formatOmId(f.task.omNo), oeTaskId: formatOeId(f.task.oeNo) },
    client: f.task.client,
    city: f.task.location.city,
    activity: f.task.activity,
    technician: f.technician,
    fitmentAt: f.task.fitmentAt.toISOString(),
    reopenCount: f.reopenCount,
    billable: f.billable,
    replacementOf: f.replacementOf && { id: f.replacementOf.id, tkId: formatTkId(f.replacementOf.tkNo) },
    updatedAt: f.updatedAt.toISOString(),
  };
}

const page = (db: BoardDb, filters: BoardFilters, status: FitmentStatus, skip: number, take: number, now: Date) =>
  db.fitment.findMany({ where: boardWhere(filters, [status], now), include: cardInclude, orderBy: cardOrder, skip, take });

/**
 * `GET /board`: the first `pageSize` cards of all 9 columns and their counts. One `groupBy` for the counts and
 * one `findMany` per status (with its relations), however many cards there are.
 */
export async function getBoard(query: BoardQuery, db: BoardDb = prisma, now = new Date()): Promise<BoardResponse> {
  const { pageSize, ...filters } = query;
  const [groups, pages] = await Promise.all([
    db.fitment.groupBy({ by: ['status'], where: boardWhere(filters, BOARD_STATUSES, now), _count: { _all: true } }),
    Promise.all(BOARD_STATUSES.map((status) => page(db, filters, status, 0, pageSize, now))),
  ]);
  const counts = new Map(groups.map((g) => [g.status, g._count._all]));
  const columns = Object.fromEntries(
    BOARD_STATUSES.map((status, i) => {
      const items = pages[i]!.map(toCard);
      const count = counts.get(status) ?? 0;
      return [status, { count, items, hasMore: count > items.length } satisfies BoardColumnDto];
    }),
  ) as BoardResponse['columns'];
  return { columns };
}

/** `GET /board/:status`: one page of one column ("Load more"). */
export async function getBoardColumn(
  status: FitmentStatus,
  query: BoardColumnQuery,
  db: BoardDb = prisma,
  now = new Date(),
): Promise<BoardColumnDto> {
  const { page: pageNo, pageSize, ...filters } = query;
  const skip = (pageNo - 1) * pageSize;
  const [count, rows] = await Promise.all([
    db.fitment.count({ where: boardWhere(filters, [status], now) }),
    page(db, filters, status, skip, pageSize, now),
  ]);
  return { count, items: rows.map(toCard), hasMore: count > skip + rows.length };
}
