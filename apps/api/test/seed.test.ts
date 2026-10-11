import { describe, expect, it } from 'vitest';
import { LOOKUP_KINDS } from '@champ/shared';
import { ACTIVITY_SEED, LOCATION_SEED, LOOKUP_SEED, MAKE_MODEL_SEED, seedMasters } from '../prisma/seed-masters';
import { ensureCounters, nextNumber } from '../src/lib/counters';
import { prisma } from '../src/lib/prisma';

async function counts() {
  const [lookups, activities, makeModels, locations, byKind] = await Promise.all([
    prisma.lookupItem.count(),
    prisma.activity.count(),
    prisma.vehicleMakeModel.count(),
    prisma.location.count(),
    prisma.lookupItem.groupBy({ by: ['kind'], _count: true, orderBy: { kind: 'asc' } }),
  ]);
  return { lookups, activities, makeModels, locations, byKind };
}

describe('master data seed', () => {
  it('seeds every master and is idempotent (same counts when run twice)', async () => {
    await seedMasters(prisma);
    const first = await counts();
    await seedMasters(prisma);
    const second = await counts();
    expect(second).toEqual(first);

    const expectedLookups = Object.values(LOOKUP_SEED).reduce((n, items) => n + items.length, 0);
    expect(first.lookups).toBe(expectedLookups);
    expect(first.byKind.map((k) => k.kind).sort()).toEqual([...LOOKUP_KINDS].sort());
    expect(first.activities).toBe(ACTIVITY_SEED.VEHICLE.length + ACTIVITY_SEED.BATTERY.length);
    expect(first.makeModels).toBe(MAKE_MODEL_SEED.length);
    expect(first.locations).toBe(LOCATION_SEED.length);
  });

  it('seeds the built-ins with codes and the system flag', async () => {
    await seedMasters(prisma);
    const system = await prisma.lookupItem.findMany({ where: { isSystem: true }, orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }] });
    expect(system.map((i) => `${i.kind}:${i.code}`)).toEqual([
      'ASSET_TYPE:VEHICLE',
      'ASSET_TYPE:BATTERY',
      'SHIFT_TYPE:DAY',
      'SHIFT_TYPE:NIGHT',
      'SHIFT_TYPE:EARLY_MORNING',
      'TASK_TYPE:OT',
      'TASK_TYPE:TT',
      'TASK_TYPE:FT',
    ]);
    const laf5 = await prisma.lookupItem.findUniqueOrThrow({ where: { kind_code: { kind: 'DEVICE_TYPE', code: 'LAF5' } } });
    expect(laf5).toMatchObject({ name: 'LAF5', isSystem: false });
    expect(await prisma.lookupItem.count({ where: { kind: 'STATE' } })).toBe(36);

    const finals = await prisma.lookupItem.findMany({ where: { kind: 'FINAL_ISSUE' } });
    expect(new Set(finals.map((f) => f.billable))).toEqual(new Set([true, false]));
    const others = await prisma.lookupItem.count({ where: { kind: { not: 'FINAL_ISSUE' }, billable: { not: null } } });
    expect(others).toBe(0);
  });

  it('keeps user changes to seeded values on a re-run', async () => {
    await seedMasters(prisma);
    const relay = await prisma.lookupItem.findUniqueOrThrow({ where: { kind_nameKey: { kind: 'ACCESSORY', nameKey: 'relay' } } });
    await prisma.lookupItem.update({ where: { id: relay.id }, data: { active: false } });
    await seedMasters(prisma);
    expect((await prisma.lookupItem.findUniqueOrThrow({ where: { id: relay.id } })).active).toBe(false);
  });
});

describe('task id counters (F04)', () => {
  it('creates the OM, OE and TK counters once and keeps their values on a re-run', async () => {
    await ensureCounters(prisma);
    expect(await prisma.counter.findMany({ orderBy: { name: 'asc' } })).toEqual([
      { name: 'OE', value: 0 },
      { name: 'OM', value: 0 },
      { name: 'TK', value: 0 },
    ]);
    const first = await prisma.$transaction((tx) => nextNumber(tx, 'TK', 3));
    expect(first).toBe(1);
    await ensureCounters(prisma);
    expect((await prisma.counter.findUniqueOrThrow({ where: { name: 'TK' } })).value).toBe(3);
    expect(await prisma.$transaction((tx) => nextNumber(tx, 'TK'))).toBe(4);
  });

  it('starts a missing counter on first use and gives numbers back when the transaction fails', async () => {
    expect(await prisma.$transaction((tx) => nextNumber(tx, 'OM'))).toBe(1);
    await expect(
      prisma.$transaction(async (tx) => {
        await nextNumber(tx, 'OM');
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await prisma.$transaction((tx) => nextNumber(tx, 'OM'))).toBe(2);
  });
});
