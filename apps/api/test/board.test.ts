import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, describe, expect, it } from 'vitest';
import type { BoardColumnDto, BoardResponse, FitmentStatus, TaskDto } from '@champ/shared';
import { getBoard } from '../src/modules/board/service';
import { PrismaClient } from '../src/generated/prisma/client';
import { prisma, type User } from '../src/lib/prisma';
import { bearer, createTaskWorld, createUser, testApi } from './helpers';

const api = () => testApi();
const DAY_MS = 24 * 3600 * 1000;

async function world() {
  const w = await createTaskWorld();
  const otherOe = await createUser({ role: 'OE', managerId: w.om.id, name: 'Other OE' });
  const createTask = async (overrides: Record<string, unknown> = {}) => {
    const res = await api().post('/api/tasks').set(bearer(w.om)).send(w.taskBody(overrides));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as TaskDto;
  };
  return { ...w, otherOe, createTask };
}

/** Puts a fitment straight into a status (the board only reads, so the workflow steps aren't needed here). */
const setStatus = (id: string, status: FitmentStatus, data: Record<string, unknown> = {}) =>
  prisma.fitment.update({ where: { id }, data: { status, ...data } });

async function board(actor: User, query: Record<string, string | number> = {}) {
  const res = await api().get('/api/board').query(query).set(bearer(actor));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body as BoardResponse).columns;
}

const tks = (column: BoardColumnDto) => column.items.map((c) => c.tkId);
const counts = (columns: BoardResponse['columns']) =>
  Object.fromEntries(Object.entries(columns).filter(([, c]) => c.count > 0).map(([s, c]) => [s, c.count]));

describe('GET /board', () => {
  it('groups fitments by status with counts, as cards with the task, customer, city, activity and technician', async () => {
    const w = await world();
    const a = await w.createTask({ vehicles: { entry: 'COUNT', count: 3 } }); // TK 1-3, Open
    const b = await w.createTask({ technicianId: w.techA.id, vehicles: { entry: 'COUNT', count: 2 }, siteId: w.client.sites[1]!.id }); // TK 4-5
    await setStatus(b.fitments[1]!.id, 'SUBMITTED');
    await setStatus(a.fitments[2]!.id, 'REOPENED', { technicianId: w.techB.id, reopenCount: 2 });
    await setStatus(a.fitments[1]!.id, 'OE_VERIFIED', { technicianId: w.techB.id, billable: true });

    const columns = await board(w.om);
    expect(Object.keys(columns).sort()).toEqual(
      ['ASSIGNED', 'CLOSED_NOT_DONE', 'IN_PROGRESS', 'MOVED_TO_FT', 'OE_VERIFIED', 'OM_APPROVED', 'OPEN', 'REOPENED', 'SUBMITTED'],
    );
    expect(counts(columns)).toEqual({ OPEN: 1, ASSIGNED: 1, SUBMITTED: 1, OE_VERIFIED: 1, REOPENED: 1 });
    expect(columns.IN_PROGRESS).toEqual({ count: 0, items: [], hasMore: false });
    expect(columns.OPEN.items[0]).toEqual({
      id: a.fitments[0]!.id,
      tkId: 'TK-00001',
      status: 'OPEN',
      task: { id: a.id, omId: 'OM-00001', oeTaskId: 'OE-00001' },
      client: { id: w.client.id, name: 'Zoomcar' },
      city: 'Bengaluru',
      activity: { id: w.vehicleInstall.id, name: 'New installation' },
      technician: null,
      fitmentAt: '2026-10-21T05:00:00.000Z',
      reopenCount: 0,
      billable: null,
      replacementOf: null,
      updatedAt: expect.any(String),
    });
    expect(columns.ASSIGNED.items[0]).toMatchObject({ tkId: 'TK-00004', city: 'Pune', technician: { id: w.techA.id, name: 'Arjun Tech' } });
    expect(columns.REOPENED.items[0]).toMatchObject({ tkId: 'TK-00003', reopenCount: 2, technician: { name: 'Bhavna Tech' } });
    expect(columns.OE_VERIFIED.items[0]).toMatchObject({ tkId: 'TK-00002', billable: true });
  });

  it('orders by fitment date, soonest first, then TK number; shows the replacement link', async () => {
    const w = await world();
    const late = await w.createTask({ fitmentAt: '2026-10-25T05:00:00.000Z', vehicles: { entry: 'COUNT', count: 2 } }); // TK 1-2
    const early = await w.createTask({ fitmentAt: '2026-10-22T05:00:00.000Z' }); // TK 3-4
    await prisma.fitment.update({ where: { id: early.fitments[1]!.id }, data: { replacementOfId: late.fitments[0]!.id } });
    const columns = await board(w.sa);
    expect(tks(columns.OPEN)).toEqual(['TK-00003', 'TK-00004', 'TK-00001', 'TK-00002']);
    expect(columns.OPEN.items[1]!.replacementOf).toEqual({ id: late.fitments[0]!.id, tkId: 'TK-00001' });
  });

  it('filters by customer, OE, technician, activity, fitment date and id (TK, OM, OE or a bare number)', async () => {
    const w = await world();
    const a = await w.createTask({ technicianId: w.techA.id }); // OM-1 / OE-1, TK 1-2, 21 Oct
    await w.createTask({
      clientId: w.otherClient.id,
      siteId: w.otherClient.sites[0]!.id,
      oeId: w.otherOe.id,
      technicianId: w.techB.id,
      assetTypeId: w.battery.id,
      activityId: w.batteryInstall.id,
      makeModelId: null,
      fitmentAt: '2026-11-05T05:00:00.000Z',
    }); // OM-2 / OE-2, TK 3-4
    await setStatus(a.fitments[1]!.id, 'IN_PROGRESS');
    const all = (columns: BoardResponse['columns']) => Object.values(columns).flatMap(tks).sort();

    expect(all(await board(w.om))).toEqual(['TK-00001', 'TK-00002', 'TK-00003', 'TK-00004']);
    expect(all(await board(w.om, { clientId: w.otherClient.id }))).toEqual(['TK-00003', 'TK-00004']);
    expect(all(await board(w.om, { oeId: w.oe.id }))).toEqual(['TK-00001', 'TK-00002']);
    expect(all(await board(w.om, { technicianId: w.techB.id }))).toEqual(['TK-00003', 'TK-00004']);
    expect(all(await board(w.om, { activityId: w.vehicleInstall.id }))).toEqual(['TK-00001', 'TK-00002']);
    expect(all(await board(w.om, { from: '2026-11-01', to: '2026-11-05' }))).toEqual(['TK-00003', 'TK-00004']);
    expect(all(await board(w.om, { to: '2026-10-21' }))).toEqual(['TK-00001', 'TK-00002']);
    expect(all(await board(w.om, { q: 'tk-2' }))).toEqual(['TK-00002']);
    expect(all(await board(w.om, { q: 'OM-00002' }))).toEqual(['TK-00003', 'TK-00004']);
    expect(all(await board(w.om, { q: 'oe 1' }))).toEqual(['TK-00001', 'TK-00002']);
    expect(all(await board(w.om, { q: '2' }))).toEqual(['TK-00002', 'TK-00003', 'TK-00004']); // TK-2 or OM-2 / OE-2
    expect(all(await board(w.om, { q: 'Zoomcar' }))).toEqual([]); // ids only
    const filtered = await board(w.om, { technicianId: w.techA.id });
    expect(counts(filtered)).toEqual({ ASSIGNED: 1, IN_PROGRESS: 1 });
  });

  it('finished columns show the last 7 days unless a fitment-date range is set (D-111)', async () => {
    const w = await world();
    const t = await w.createTask({ technicianId: w.techA.id, vehicles: { entry: 'COUNT', count: 4 } });
    const old = new Date(Date.now() - 10 * DAY_MS);
    const recent = new Date(Date.now() - 2 * DAY_MS);
    await setStatus(t.fitments[0]!.id, 'OM_APPROVED', { approvedAt: old });
    await setStatus(t.fitments[1]!.id, 'OM_APPROVED', { approvedAt: recent });
    await setStatus(t.fitments[2]!.id, 'CLOSED_NOT_DONE', { closedAt: old });
    await setStatus(t.fitments[3]!.id, 'MOVED_TO_FT', { faultyAt: recent });

    const recentOnly = await board(w.om);
    expect(tks(recentOnly.OM_APPROVED)).toEqual(['TK-00002']);
    expect(recentOnly.OM_APPROVED.count).toBe(1);
    expect(recentOnly.CLOSED_NOT_DONE).toEqual({ count: 0, items: [], hasMore: false });
    expect(tks(recentOnly.MOVED_TO_FT)).toEqual(['TK-00004']);

    // A range covering the fitment date (21 Oct 2026) shows the old ones too.
    const ranged = await board(w.om, { from: '2026-10-20', to: '2026-10-22' });
    expect(tks(ranged.OM_APPROVED)).toEqual(['TK-00001', 'TK-00002']);
    expect(ranged.CLOSED_NOT_DONE.count).toBe(1);
    // The column endpoint follows the same rule.
    const col = await api().get('/api/board/OM_APPROVED').set(bearer(w.om));
    expect((col.body as BoardColumnDto).count).toBe(1);
  });

  it('pages columns through /board/:status ("Load more") and leaves deleted tasks out', async () => {
    const w = await world();
    await w.createTask({ vehicles: { entry: 'COUNT', count: 5 } }); // TK 1-5
    const deleted = await w.createTask(); // TK 6-7
    expect((await api().delete(`/api/tasks/${deleted.id}`).set(bearer(w.om))).status).toBe(204);

    const first = await board(w.om, { pageSize: 2 });
    expect(first.OPEN).toMatchObject({ count: 5, hasMore: true });
    expect(tks(first.OPEN)).toEqual(['TK-00001', 'TK-00002']);

    const page = async (n: number) => {
      const res = await api().get('/api/board/OPEN').query({ page: n, pageSize: 2 }).set(bearer(w.om));
      expect(res.status).toBe(200);
      return res.body as BoardColumnDto;
    };
    expect(await page(2)).toMatchObject({ count: 5, hasMore: true, items: [{ tkId: 'TK-00003' }, { tkId: 'TK-00004' }] });
    expect(await page(3)).toMatchObject({ count: 5, hasMore: false, items: [{ tkId: 'TK-00005' }] });
    expect((await api().get('/api/board/DONE').set(bearer(w.om))).status).toBe(400);
    expect((await api().get('/api/board').query({ pageSize: 101 }).set(bearer(w.om))).status).toBe(400);
  });

  it('is SA/OM only: OE, RO and OT get 403', async () => {
    const w = await world();
    for (const actor of [w.oe, w.ro, w.techA]) {
      expect((await api().get('/api/board').set(bearer(actor))).status, actor.role).toBe(403);
      expect((await api().get('/api/board/OPEN').set(bearer(actor))).status, actor.role).toBe(403);
    }
    expect((await api().get('/api/board')).status).toBe(401);
  });

  describe('query count', () => {
    const logged = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
      log: [{ emit: 'event', level: 'query' }],
    });
    let queries = 0;
    logged.$on('query', () => {
      queries += 1;
    });
    afterAll(() => logged.$disconnect());

    const countQueries = async () => {
      queries = 0;
      const res = await getBoard({ pageSize: 50 }, logged);
      return { queries, cards: Object.values(res.columns).reduce((n, c) => n + c.items.length, 0) };
    };

    it('stays constant as the number of cards grows', async () => {
      const w = await world();
      const t = await w.createTask({ technicianId: w.techA.id, vehicles: { entry: 'COUNT', count: 2 } });
      await setStatus(t.fitments[0]!.id, 'SUBMITTED');
      const small = await countQueries();
      const big = await w.createTask({ technicianId: w.techB.id, vehicles: { entry: 'COUNT', count: 30 } });
      for (const f of big.fitments.slice(0, 10)) await setStatus(f.id, 'OE_VERIFIED', { billable: false });
      await prisma.fitment.update({ where: { id: big.fitments[20]!.id }, data: { replacementOfId: t.fitments[1]!.id } });
      const large = await countQueries();
      expect(small.cards).toBe(2);
      expect(large.cards).toBe(32);
      expect(large.queries).toBe(small.queries);
      expect(small.queries).toBeGreaterThan(0);
    });
  });
});
