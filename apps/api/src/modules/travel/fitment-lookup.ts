import { FITMENT_LOOKUP_LIMIT, formatOmId, formatTkId, parseTaskId, type FitmentLookupItemDto } from '@champ/shared';
import type { Prisma } from '../../generated/prisma/client';
import { prisma } from '../../lib/prisma';

/** Highest TK number a prefix search reaches (keeps the ranges within the 9-digit ids `parseTaskId` reads). */
const MAX_TK = 999_999_999;

/**
 * The TK numbers a typed id stands for: `TK-00012` (padded, 5+ digits) is exactly 12; a short number is also a
 * prefix, so `12` matches 12, 120–129, 1200–1299 and so on, as the user keeps typing.
 */
function tkNumbersWhere(digits: string, n: number): Prisma.FitmentWhereInput {
  if (digits.length >= 5) return { tkNo: n };
  const or: Prisma.FitmentWhereInput[] = [{ tkNo: n }];
  for (let scale = 10; n * scale <= MAX_TK && or.length < 6; scale *= 10) {
    or.push({ tkNo: { gte: n * scale, lte: Math.min(n * scale + scale - 1, MAX_TK) } });
  }
  return { OR: or };
}

/**
 * `GET /fitments/lookup?q=` (F08 related-task combobox): up to 10 fitments of tasks that aren't deleted whose TK
 * id matches `q` (`TK-00012`, `tk 12` or `12`), lowest TK first. Any technician's fitment may be linked.
 * Anything that isn't a TK id or number matches nothing.
 */
export async function lookupFitments(q: string): Promise<{ items: FitmentLookupItemDto[] }> {
  const parsed = parseTaskId(q);
  if (!parsed || (parsed.prefix && parsed.prefix !== 'TK')) return { items: [] };
  const digits = /(\d+)\s*$/.exec(q.trim())![1]!;
  const rows = await prisma.fitment.findMany({
    where: { AND: [tkNumbersWhere(digits, parsed.number), { task: { deletedAt: null } }] },
    select: {
      id: true,
      tkNo: true,
      status: true,
      technician: { select: { name: true } },
      task: { select: { omNo: true, client: { select: { name: true } } } },
    },
    orderBy: { tkNo: 'asc' },
    take: FITMENT_LOOKUP_LIMIT,
  });
  return {
    items: rows.map((f) => ({
      id: f.id,
      tkId: formatTkId(f.tkNo),
      omId: formatOmId(f.task.omNo),
      client: f.task.client.name,
      status: f.status,
      technician: f.technician?.name ?? null,
    })),
  };
}
