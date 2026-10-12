import { describe, expect, it } from 'vitest';
import {
  SEARCH_IDENTIFIERS,
  type GlobalSearchResponse,
  type SearchIdentifier,
  type SearchIdentifierSettingDto,
  type SearchTaskHit,
  type SearchTravelHit,
  type TaskDto,
} from '@champ/shared';
import { prisma, type User } from '../src/lib/prisma';
import { bearer, createTaskWorld, testApi } from './helpers';

const api = () => testApi();

/** Task A: OM-1/OE-1 with TK-1..TK-3; task B: OM-2/OE-2 with TK-4. */
async function setup() {
  const w = await createTaskWorld();
  const createTask = async (count: number) => {
    const res = await api().post('/api/tasks').set(bearer(w.om)).send(w.taskBody({ vehicles: { entry: 'COUNT', count } }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const task = res.body as TaskDto;
    return { task, fids: task.fitments.map((f) => f.id) };
  };
  const a = await createTask(3);
  const b = await createTask(1);
  return { ...w, a, b };
}

const search = async (actor: User, q: string, limit?: number) => {
  const res = await api()
    .get('/api/search')
    .query(limit ? { q, limit } : { q })
    .set(bearer(actor));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as GlobalSearchResponse;
};
const taskHits = (r: GlobalSearchResponse) => r.hits.filter((h): h is SearchTaskHit => h.kind === 'TASK');
const fitmentMatches = (r: GlobalSearchResponse) =>
  taskHits(r).flatMap((t) => t.fitments.map((f) => ({ fitmentId: f.fitmentId, matches: f.matches })));

const setFitment = (id: string, data: Record<string, string | null>) => prisma.fitment.update({ where: { id }, data });

const settingsBody = (order: readonly SearchIdentifier[] = SEARCH_IDENTIFIERS, off: SearchIdentifier[] = []) => ({
  items: order.map((identifier) => ({ identifier, enabled: !off.includes(identifier) })),
});
const putSettings = (actor: User, body: object) => api().put('/api/search/identifiers').set(bearer(actor)).send(body);

describe('GET /search', () => {
  it('finds OM, OE, TK ids exactly, with or without the prefix and leading zeros', async () => {
    const w = await setup();
    const om = await search(w.ro, 'OM-00002');
    expect(taskHits(om).map((t) => [t.taskId, t.matches, t.fitments])).toEqual([[w.b.task.id, [{ identifier: 'OM_ID', value: 'OM-00002' }], []]]);
    expect(om.hits[0]).toMatchObject({ omId: 'OM-00002', oeTaskId: 'OE-00002', customer: 'Zoomcar', site: 'Bengaluru depot', status: 'OPEN' });

    const oe = await search(w.oe, 'oe 2');
    expect(taskHits(oe)[0]!.matches).toEqual([{ identifier: 'OE_TASK_ID', value: 'OE-00002' }]);

    const tk = await search(w.sa, 'tk3');
    expect(taskHits(tk).map((t) => t.taskId)).toEqual([w.a.task.id]);
    expect(taskHits(tk)[0]!.fitments).toEqual([
      { fitmentId: w.a.fids[2], tkId: 'TK-00003', status: 'OPEN', vehicleRegNo: null, matches: [{ identifier: 'TK_ID', value: 'TK-00003' }] },
    ]);
    expect(tk).toMatchObject({ total: 1, truncated: false });
  });

  it('a bare number finds OM, OE and TK ids, a task once with its matched fitments', async () => {
    const w = await setup();
    const r = await search(w.om, '0002');
    // Task B by OM-2 and OE-2 (task-level), task A by TK-2 (fitment).
    expect(taskHits(r).map((t) => t.taskId).sort()).toEqual([w.a.task.id, w.b.task.id].sort());
    const b = taskHits(r).find((t) => t.taskId === w.b.task.id)!;
    expect(b.matches.map((m) => m.identifier)).toEqual(['OM_ID', 'OE_TASK_ID']);
    expect(b.fitments).toEqual([]);
    const a = taskHits(r).find((t) => t.taskId === w.a.task.id)!;
    expect(a.fitments.map((f) => f.tkId)).toEqual(['TK-00002']);
    expect(r.total).toBe(2);
  });

  it('finds travel tasks by TT id within the travel scope', async () => {
    const w = await setup();
    const tt = await prisma.travelTask.create({
      data: { ttNo: 4, technicianId: w.techA.id, locationId: w.location.id, purpose: 'Site visit', travelDate: new Date('2026-10-10'), source: 'WEB', raisedById: w.om.id },
    });
    const r = await search(w.ro, 'TT-00004');
    expect(r.hits).toEqual([
      { kind: 'TRAVEL', travelTaskId: tt.id, ttId: 'TT-00004', technician: 'Arjun Tech', status: 'RAISED', matches: [{ identifier: 'TT_ID', value: 'TT-00004' }] },
    ] satisfies SearchTravelHit[]);
    // A bare number doesn't look for TT ids; an OE outside the technician's team doesn't see it.
    expect((await search(w.ro, '4')).hits.some((h) => h.kind === 'TRAVEL')).toBe(false);
    const otherOe = await prisma.user.create({ data: { email: 'oe2@intellicar.in', name: 'Other OE', role: 'OE', status: 'ACTIVE' } });
    expect((await search(otherOe, 'tt4')).hits).toEqual([]);
  });

  it('finds each text identifier by "contains", ignoring case, spaces and hyphens', async () => {
    const w = await setup();
    const [f1, f2, f3] = w.a.fids as [string, string, string];
    await setFitment(f1, { deviceId: 'LAF5-00123', secondaryDeviceId: 'SEC 7788' });
    await setFitment(f2, { oldDeviceId: 'old-dev-991', chassisNo: 'MA1PA2XYZ' });
    await setFitment(f3, { assetNumber: 'AST/55-01', vehicleRegNo: 'KA01AB1234' });
    const cases: [string, string, SearchIdentifier, string][] = [
      ['laf5 00123', f1, 'DEVICE_ID', 'LAF5-00123'],
      ['00123', f1, 'DEVICE_ID', 'LAF5-00123'],
      ['sec-77', f1, 'SECONDARY_DEVICE_ID', 'SEC 7788'],
      ['DEV991', f2, 'OLD_DEVICE_ID', 'old-dev-991'],
      ['pa2x', f2, 'CHASSIS_NO', 'MA1PA2XYZ'],
      ['ast/55', f3, 'ASSET_NO', 'AST/55-01'],
      ['ka 01 ab', f3, 'VEHICLE_REG_NO', 'KA01AB1234'],
    ];
    for (const [q, fitmentId, identifier, value] of cases) {
      expect(fitmentMatches(await search(w.oe, q)), q).toEqual([{ fitmentId, matches: [{ identifier, value }] }]);
    }
    const hit = taskHits(await search(w.oe, 'ka01'))[0]!.fitments[0]!;
    expect(hit).toMatchObject({ tkId: 'TK-00003', vehicleRegNo: 'KA01AB1234' });
  });

  it('needs 3 characters for "contains" (an id parses at any length) and treats % and _ literally', async () => {
    const w = await setup();
    await setFitment(w.a.fids[0]!, { deviceId: 'AB_CD%EF' });
    await setFitment(w.a.fids[1]!, { deviceId: 'ABXCDYEF' });
    expect(await search(w.oe, 'ab')).toEqual({ q: 'ab', hits: [], total: 0, truncated: false });
    expect(await search(w.oe, 'a - b')).toMatchObject({ hits: [], total: 0 });
    expect(fitmentMatches(await search(w.oe, 'b_c')).map((f) => f.fitmentId)).toEqual([w.a.fids[0]]);
    expect(fitmentMatches(await search(w.oe, 'd%e')).map((f) => f.fitmentId)).toEqual([w.a.fids[0]]);
    expect(fitmentMatches(await search(w.oe, '%%%'))).toEqual([]);
  });

  it('runs both an id and "contains" when the query is both, exact ids first', async () => {
    const w = await setup();
    await setFitment(w.b.fids[0]!, { deviceId: 'DEV-0003-X' });
    const r = await search(w.oe, '0003');
    // TK-3 (task A, exact id) first, then the device id containing 0003 (task B).
    expect(taskHits(r).map((t) => t.taskId)).toEqual([w.a.task.id, w.b.task.id]);
    expect(taskHits(r)[1]!.fitments[0]!.matches).toEqual([{ identifier: 'DEVICE_ID', value: 'DEV-0003-X' }]);
    expect(r.total).toBe(2);
  });

  it('groups fitments under their task and ranks by sortOrder, then exact before contains, then newest task', async () => {
    const w = await setup();
    const [a1, a2] = w.a.fids as [string, string, string];
    const b1 = w.b.fids[0]!;
    await setFitment(a1, { vehicleRegNo: 'KA05XY9999' });
    await setFitment(a2, { deviceId: 'XY999' });
    await setFitment(b1, { deviceId: 'ZZXY999' });
    let r = await search(w.oe, 'xy999');
    // Device id (sortOrder 4) before reg no. (9); within device id the exact value first.
    expect(taskHits(r).map((t) => t.taskId)).toEqual([w.a.task.id, w.b.task.id]);
    expect(taskHits(r)[0]!.fitments.map((f) => f.fitmentId)).toEqual([a2, a1]);
    expect(r.total).toBe(3);

    // Reg no. ranked first: task A (reg no. on a1) leads, its fitments in rank order.
    const order = ['VEHICLE_REG_NO', ...SEARCH_IDENTIFIERS.filter((i) => i !== 'VEHICLE_REG_NO')] as SearchIdentifier[];
    expect((await putSettings(w.sa, settingsBody(order))).status).toBe(200);
    r = await search(w.oe, 'xy999');
    expect(taskHits(r)[0]!.fitments.map((f) => f.fitmentId)).toEqual([a1, a2]);

    // Same identifier and both "contains": the newer task first.
    await setFitment(a2, { deviceId: 'QXY999' });
    await setFitment(a1, { vehicleRegNo: null });
    r = await search(w.oe, 'xy999');
    expect(taskHits(r).map((t) => t.taskId)).toEqual([w.b.task.id, w.a.task.id]);
  });

  it('applies the limit to fitment rows and flags truncation', async () => {
    const w = await setup();
    for (const [i, id] of [...w.a.fids, ...w.b.fids].entries()) await setFitment(id, { deviceId: `LIM-${i}` });
    const r = await search(w.oe, 'lim', 2);
    expect(fitmentMatches(r)).toHaveLength(2);
    expect(r).toMatchObject({ total: 4, truncated: true });
    const all = await search(w.oe, 'lim');
    expect(fitmentMatches(all)).toHaveLength(4);
    expect(all).toMatchObject({ total: 4, truncated: false });
  });

  it('never shows deleted tasks', async () => {
    const w = await setup();
    await setFitment(w.b.fids[0]!, { deviceId: 'GONE-777' });
    await prisma.task.update({ where: { id: w.b.task.id }, data: { deletedAt: new Date(), deletedById: w.om.id } });
    expect((await search(w.sa, 'gone777')).hits).toEqual([]);
    expect((await search(w.sa, 'OM-2')).hits).toEqual([]);
    expect((await search(w.sa, 'TK-4')).hits).toEqual([]);
  });

  it('skips identifiers the SA switched off', async () => {
    const w = await setup();
    await setFitment(w.a.fids[0]!, { deviceId: 'OFF-123', chassisNo: 'CH-OFF-1' });
    expect((await putSettings(w.sa, settingsBody(SEARCH_IDENTIFIERS, ['DEVICE_ID', 'TK_ID']))).status).toBe(200);
    expect(fitmentMatches(await search(w.oe, 'off'))).toEqual([{ fitmentId: w.a.fids[0], matches: [{ identifier: 'CHASSIS_NO', value: 'CH-OFF-1' }] }]);
    expect((await search(w.oe, 'TK-1')).hits).toEqual([]);
    expect(taskHits(await search(w.oe, '1')).map((t) => [t.matches.length, t.fitments.length])).toEqual([[2, 0]]);
  });

  it('is for task viewers only (OT 403) and validates q', async () => {
    const w = await setup();
    expect((await api().get('/api/search').query({ q: 'TK-1' }).set(bearer(w.ot))).status).toBe(403);
    expect((await api().get('/api/search').query({ q: 'TK-1' })).status).toBe(401);
    expect((await api().get('/api/search').query({ q: '  ' }).set(bearer(w.oe))).status).toBe(400);
  });
});

describe('/search/identifiers', () => {
  it('lists the identifiers in ranking order, for the SA only', async () => {
    const w = await createTaskWorld();
    const res = await api().get('/api/search/identifiers').set(bearer(w.sa));
    expect(res.status).toBe(200);
    const list = res.body as SearchIdentifierSettingDto[];
    expect(list.map((s) => s.identifier)).toEqual([...SEARCH_IDENTIFIERS]);
    expect(list[0]).toEqual({ identifier: 'OM_ID', label: 'OM id', enabled: true, sortOrder: 0 });
    for (const role of ['om', 'oe', 'ot', 'ro'] as const) {
      expect((await api().get('/api/search/identifiers').set(bearer(w[role]))).status, role).toBe(403);
      expect((await putSettings(w[role], settingsBody())).status, role).toBe(403);
    }
  });

  it('PUT reorders and toggles', async () => {
    const w = await createTaskWorld();
    const order = [...SEARCH_IDENTIFIERS].reverse();
    const res = await putSettings(w.sa, settingsBody(order, ['CHASSIS_NO']));
    expect(res.status).toBe(200);
    const list = res.body as SearchIdentifierSettingDto[];
    expect(list.map((s) => s.identifier)).toEqual(order);
    expect(list.filter((s) => !s.enabled).map((s) => s.identifier)).toEqual(['CHASSIS_NO']);
    expect(list.map((s) => s.sortOrder)).toEqual(order.map((_, i) => i));
    const again = (await api().get('/api/search/identifiers').set(bearer(w.sa))).body as SearchIdentifierSettingDto[];
    expect(again).toEqual(list);
  });

  it('keeps at least one identifier on and every identifier exactly once', async () => {
    const w = await createTaskWorld();
    expect((await putSettings(w.sa, settingsBody(SEARCH_IDENTIFIERS, [...SEARCH_IDENTIFIERS]))).status).toBe(400);
    expect((await putSettings(w.sa, { items: settingsBody().items.slice(1) })).status).toBe(400);
    const dup = settingsBody().items;
    dup[1] = dup[0]!;
    expect((await putSettings(w.sa, { items: dup })).status).toBe(400);
    expect((await putSettings(w.sa, { items: [...settingsBody().items.slice(1), { identifier: 'NAME', enabled: true }] })).status).toBe(400);
  });
});
