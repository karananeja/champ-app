import type { Prisma, PrismaClient } from '../generated/prisma/client';

/** Human id counters (D-065): OM-00001, OE-00001 and TK-00001. */
export const COUNTER_NAMES = ['OM', 'OE', 'TK'] as const;
export type CounterName = (typeof COUNTER_NAMES)[number];

/**
 * Reserves `count` consecutive numbers of a counter and returns the first one. Runs as a single atomic
 * upsert inside the caller's transaction: the counter row stays locked until it commits, so concurrent
 * creators get distinct numbers, and a rolled-back transaction gives its numbers back.
 */
export async function nextNumber(tx: Prisma.TransactionClient, name: CounterName, count = 1): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "Counter" ("name", "value") VALUES (${name}, ${count})
    ON CONFLICT ("name") DO UPDATE SET "value" = "Counter"."value" + EXCLUDED."value"
    RETURNING "value"`;
  return rows[0]!.value - count + 1;
}

/** Creates the counter rows if missing (base seed). Existing values are left alone. */
export async function ensureCounters(db: PrismaClient): Promise<void> {
  for (const name of COUNTER_NAMES) {
    await db.counter.upsert({ where: { name }, create: { name, value: 0 }, update: {} });
  }
}
