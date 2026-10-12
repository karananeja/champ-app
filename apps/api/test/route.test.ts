import { describe, expect, it } from 'vitest';
import {
  istDayStart,
  mobileDateOptions,
  type DayRouteDto,
  type FitmentAction,
  type FitmentStatus,
  type MyFitmentDto,
  type TaskDto,
  type TaskOptionsResponse,
} from '@champ/shared';
import { StubRouter, parseTrip, straightLineTrip } from '../src/lib/router';
import { prisma, type User } from '../src/lib/prisma';
import { bearer, createLookup, createTaskWorld, createUser, fakeGoogle, testApi } from './helpers';

// F10: day route, strict start order and OEs doing fitments (spec §7).
const [TODAY, YESTERDAY] = mobileDateOptions(new Date()) as [string, string];
const HOUR = 3_600_000;
const at = (day: string, hours: number) => new Date(istDayStart(day)!.getTime() + hours * HOUR);

/** Three sites on a line going north from the GPS point: A is nearest, C farthest. */
const GPS = { lat: 12.8, lng: 77.6 };

async function routeWorld() {
  const w = await createTaskWorld();
  const stub = new StubRouter();
  const api = () => testApi(fakeGoogle(null), { router: stub });
  const closeReason = await createLookup('CLOSE_REASON', 'Client not available');
  const site = (name: string, lat: number) =>
    prisma.clientSite.create({
      data: { clientId: w.client.id, name, nameKey: name.toLowerCase(), address: `${name} road`, lat, lng: 77.6, locationId: w.location.id },
    });
  const sites = { A: await site('Site A', 12.9), B: await site('Site B', 12.95), C: await site('Site C', 13.1) };

  /** One task with one fitment at `siteKey`, assigned to `technician` (default tech A) in `status`. */
  const fitment = async (
    siteKey: keyof typeof sites,
    fitmentAt: Date,
    opts: { technician?: User | null; status?: FitmentStatus; oe?: User; data?: Record<string, unknown> } = {},
  ) => {
    const res = await api()
      .post('/api/tasks')
      .set(bearer(w.om))
      .send(w.taskBody({ siteId: sites[siteKey].id, vehicles: { entry: 'COUNT', count: 1 }, ...(opts.oe && { oeId: opts.oe.id }) }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const task = res.body as TaskDto;
    await prisma.task.update({ where: { id: task.id }, data: { fitmentAt } });
    const technician = opts.technician === undefined ? w.techA : opts.technician;
    return prisma.fitment.update({
      where: { id: task.fitments[0]!.id },
      data: { technicianId: technician?.id ?? null, status: opts.status ?? 'ASSIGNED', ...opts.data },
    });
  };
  const route = (user: User, query: Record<string, unknown> = { date: TODAY, ...GPS }) =>
    api().get('/api/mobile/route').query(query).set(bearer(user));
  const recalc = (user: User, body: Record<string, unknown>) => api().post('/api/mobile/route/recalculate').set(bearer(user)).send(body);
  const transition = (actor: User, fid: string, action: FitmentAction, payload?: unknown) =>
    api().post(`/api/fitments/${fid}/transitions`).set(bearer(actor)).send({ action, payload });
  const START = { lat: 12.9, lng: 77.6 };
  const close = { closeReasonId: closeReason.id, comments: 'Gate locked' };
  return { ...w, stub, api, sites, fitment, route, recalc, transition, START, close };
}

const tks = (r: DayRouteDto) => r.stops.map((s) => s.fitment.tkId);
const tk = (f: { tkNo: number }) => `TK-${String(f.tkNo).padStart(5, '0')}`;

describe('router lib', () => {
  it('straight-line fallback is nearest neighbour with rounded legs and no durations', () => {
    const trip = straightLineTrip(GPS, [
      { lat: 13.1, lng: 77.6 },
      { lat: 12.9, lng: 77.6 },
    ]);
    expect(trip.order).toEqual([1, 0]);
    expect(trip.legs[0]!.durationS).toBeNull();
    expect(trip.legs[0]!.distanceM).toBeGreaterThan(11_000);
    expect(trip.legs[0]!.distanceM).toBeLessThan(11_200);
    expect(trip.geometry).toBeNull();
  });

  it('maps an OSRM trip (waypoint_index order, legs, geometry) and rejects NoTrips', () => {
    const trip = parseTrip(
      {
        code: 'Ok',
        waypoints: [
          { waypoint_index: 0, trips_index: 0 },
          { waypoint_index: 2, trips_index: 0 },
          { waypoint_index: 1, trips_index: 0 },
        ],
        trips: [{ legs: [{ distance: 100.4, duration: 10.6 }, { distance: 200, duration: 20 }], geometry: { type: 'LineString', coordinates: [[1, 2]] } }],
      },
      2,
    );
    expect(trip).toEqual({ order: [1, 0], legs: [{ distanceM: 100, durationS: 11 }, { distanceM: 200, durationS: 20 }], geometry: { type: 'LineString', coordinates: [[1, 2]] } });
    expect(() => parseTrip({ code: 'NoTrips' }, 2)).toThrow();
  });
});

describe('GET /api/mobile/route', () => {
  it('OSRM order from GPS: legs, geometry, next and blocked stops; stored', async () => {
    const w = await routeWorld();
    const a = await w.fitment('A', at(TODAY, 9));
    const b = await w.fitment('B', at(TODAY, 10));
    const c = await w.fitment('C', at(TODAY, 11));
    const res = await w.route(w.techA);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const r = res.body as DayRouteDto;
    // The stub reverses the nearest-neighbour order.
    expect(tks(r)).toEqual([tk(c), tk(b), tk(a)]);
    expect(r).toMatchObject({ date: TODAY, engine: 'OSRM', origin: { ...GPS, source: 'GPS' } });
    expect(r.geometry?.type).toBe('LineString');
    expect(r.stops.map((s) => [s.order, s.isNext, s.blockedBy, s.done])).toEqual([
      [1, true, null, false],
      [2, false, tk(c), false],
      [3, false, tk(c), false],
    ]);
    expect(r.stops.every((s) => s.legFromPrevious && s.legFromPrevious.durationS !== null)).toBe(true);
    expect(r.totalDistanceM).toBe(r.stops.reduce((sum, s) => sum + s.legFromPrevious!.distanceM, 0));
    const f = r.stops[0]!.fitment;
    expect(f).toMatchObject({ assetType: 'Vehicle', installationType: 'GPS', availableActions: ['START', 'CLOSE_NOT_DONE', 'MARK_FAULTY'] });
    expect(f.oe?.name).toBe(w.oe.name);
    expect(await prisma.dayRoute.count()).toBe(1);
    expect(w.stub.calls).toHaveLength(1);
  });

  it('falls back to straight lines when routing fails', async () => {
    const w = await routeWorld();
    w.stub.fail = true;
    const c = await w.fitment('C', at(TODAY, 9));
    const a = await w.fitment('A', at(TODAY, 10));
    const r = (await w.route(w.techA)).body as DayRouteDto;
    expect(tks(r)).toEqual([tk(a), tk(c)]);
    expect(r.engine).toBe('STRAIGHT_LINE');
    expect(r.geometry).toBeNull();
    expect(r.stops.map((s) => s.legFromPrevious?.durationS)).toEqual([null, null]);
  });

  it('origin: HOME without GPS; none without either (earliest stop first, no first leg)', async () => {
    const w = await routeWorld();
    w.stub.fail = true;
    const c = await w.fitment('C', at(TODAY, 9));
    const a = await w.fitment('A', at(TODAY, 10));
    const b = await w.fitment('B', at(TODAY, 11));
    let r = (await w.route(w.techA, { date: TODAY })).body as DayRouteDto;
    expect(r.origin).toBeNull();
    expect(r.engine).toBe('STRAIGHT_LINE');
    expect(tks(r)).toEqual([tk(c), tk(b), tk(a)]);
    expect(r.stops[0]!.legFromPrevious).toBeNull();
    expect(r.stops[1]!.legFromPrevious?.distanceM).toBeGreaterThan(0);

    await prisma.user.update({ where: { id: w.techA.id }, data: { homeLat: 12.0, homeLng: 77.6, homeAddress: 'Home', homeUpdatedAt: new Date() } });
    await prisma.dayRoute.deleteMany(); // force a recompute without GPS
    r = (await w.route(w.techA, { date: TODAY })).body as DayRouteDto;
    expect(r.origin).toEqual({ lat: 12.0, lng: 77.6, source: 'HOME' });
    expect(tks(r)).toEqual([tk(a), tk(b), tk(c)]);
  });

  it('done stops come first in finish order; only open legs count; no open stops → nothing stored', async () => {
    const w = await routeWorld();
    const closed = await w.fitment('A', at(TODAY, 9), { status: 'CLOSED_NOT_DONE', data: { closedAt: at(TODAY, 12) } });
    const submitted = await w.fitment('B', at(TODAY, 10), { status: 'SUBMITTED', data: { submittedAt: at(TODAY, 11) } });
    let r = (await w.route(w.techA)).body as DayRouteDto;
    expect(tks(r)).toEqual([tk(submitted), tk(closed)]);
    expect(r).toMatchObject({ origin: null, engine: null, totalDistanceM: 0, computedAt: null, geometry: null });
    expect(r.stops.every((s) => s.done && !s.isNext && s.legFromPrevious === null)).toBe(true);
    expect(await prisma.dayRoute.count()).toBe(0);
    expect(w.stub.calls).toHaveLength(0);

    const open = await w.fitment('C', at(TODAY, 8));
    r = (await w.route(w.techA)).body as DayRouteDto;
    expect(tks(r)).toEqual([tk(submitted), tk(closed), tk(open)]);
    expect(r.stops.map((s) => s.order)).toEqual([1, 2, 3]);
    expect(r.stops[2]).toMatchObject({ isNext: true, done: false });
    expect(r.totalDistanceM).toBe(r.stops[2]!.legFromPrevious!.distanceM);
  });

  it('reuses the stored order while the open set is unchanged; recomputes when a fitment is added or closed', async () => {
    const w = await routeWorld();
    const a = await w.fitment('A', at(TODAY, 9));
    const b = await w.fitment('B', at(TODAY, 10));
    const first = (await w.route(w.techA)).body as DayRouteDto;
    const again = (await w.route(w.techA, { date: TODAY, lat: 13.5, lng: 77.6 })).body as DayRouteDto;
    expect(again.computedAt).toBe(first.computedAt);
    expect(tks(again)).toEqual(tks(first));
    expect(again.origin).toEqual(first.origin);
    expect(w.stub.calls).toHaveLength(1);

    const c = await w.fitment('C', at(TODAY, 11));
    const added = (await w.route(w.techA)).body as DayRouteDto;
    expect(w.stub.calls).toHaveLength(2);
    expect(tks(added)).toEqual([tk(c), tk(b), tk(a)]);

    expect((await w.transition(w.techA, c.id, 'CLOSE_NOT_DONE', w.close)).status).toBe(200);
    const afterClose = (await w.route(w.techA)).body as DayRouteDto;
    expect(w.stub.calls).toHaveLength(3);
    expect(w.stub.calls[2]!.stops).toHaveLength(2); // only the open stops are re-routed
    expect(tks(afterClose)[0]).toBe(tk(c));
    expect(afterClose.stops[0]!.done).toBe(true);
  });

  it('recalculate needs the GPS position and always recomputes', async () => {
    const w = await routeWorld();
    await w.fitment('A', at(TODAY, 9));
    await w.route(w.techA);
    expect((await w.recalc(w.techA, { date: TODAY })).status).toBe(400);
    expect((await w.recalc(w.techA, { date: TODAY, lat: 12.9 })).status).toBe(400);
    const res = await w.recalc(w.techA, { date: TODAY, lat: 13.5, lng: 77.6 });
    expect(res.status).toBe(200);
    expect((res.body as DayRouteDto).origin).toEqual({ lat: 13.5, lng: 77.6, source: 'GPS' });
    expect(w.stub.calls).toHaveLength(2);
  });

  it('IST day boundaries, past days, only my fitments, deleted tasks left out', async () => {
    const w = await routeWorld();
    const start = istDayStart(TODAY)!;
    const inside = await w.fitment('A', start);
    await w.fitment('B', new Date(start.getTime() - 1)); // yesterday 23:59:59.999 IST
    await w.fitment('C', at(TODAY, 10), { technician: w.techB });
    const r = (await w.route(w.techA)).body as DayRouteDto;
    expect(tks(r)).toEqual([tk(inside)]);
    const past = (await w.route(w.techA, { date: YESTERDAY })).body as DayRouteDto;
    expect(past.stops).toHaveLength(1);
    await prisma.task.update({ where: { id: inside.taskId }, data: { deletedAt: new Date() } });
    expect(((await w.route(w.techA)).body as DayRouteDto).stops).toHaveLength(0);
  });

  it('access and validation: SA/OM/RO 403; bad dates and half coordinates 400', async () => {
    const w = await routeWorld();
    for (const user of [w.sa, w.om, w.ro]) expect((await w.route(user)).status).toBe(403);
    expect((await w.route(w.techA, { date: '2001-01-01' })).status).toBe(400);
    expect((await w.route(w.techA, { date: TODAY, lat: 12 })).status).toBe(400);
    expect((await w.route(w.techA, { date: TODAY, lat: 'x', lng: 1 })).status).toBe(400);
    expect((await w.api().get('/api/mobile/route').query({ date: TODAY })).status).toBe(401);
  });
});

describe('START order (D-156)', () => {
  it('only the next stop can start; an In-progress stop blocks the rest; close and faulty are not restricted', async () => {
    const w = await routeWorld();
    const a = await w.fitment('A', at(TODAY, 9));
    const b = await w.fitment('B', at(TODAY, 10));
    const c = await w.fitment('C', at(TODAY, 11));
    await w.route(w.techA); // order C, B, A

    let res = await w.transition(w.techA, a.id, 'START', w.START);
    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({ code: 'ROUTE_ORDER', message: `Finish or close ${tk(c)} first` });
    expect((await prisma.fitment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('ASSIGNED');

    expect((await w.transition(w.techA, c.id, 'START', w.START)).status).toBe(200);
    res = await w.transition(w.techA, b.id, 'START', w.START);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe(`Finish or close ${tk(c)} first`);

    // Skipping by closing or marking faulty is allowed out of order.
    expect((await w.transition(w.techA, b.id, 'CLOSE_NOT_DONE', w.close)).status).toBe(200);
    expect((await w.transition(w.techA, a.id, 'MARK_FAULTY', { reason: 'Dead unit' })).status).toBe(200);
    expect((await w.transition(w.techA, c.id, 'CLOSE_NOT_DONE', w.close)).status).toBe(200);
  });

  it('without a stored route any open fitment may start; concurrent starts still let one through', async () => {
    const w = await routeWorld();
    const a = await w.fitment('A', at(TODAY, 9));
    const b = await w.fitment('B', at(TODAY, 10));
    expect((await w.transition(w.techA, b.id, 'START', w.START)).status).toBe(200);
    expect((await w.transition(w.techA, a.id, 'START', w.START)).status).toBe(200);

    const c = await w.fitment('C', at(YESTERDAY, 9));
    const results = await Promise.all([w.transition(w.techA, c.id, 'START', w.START), w.transition(w.techA, c.id, 'START', w.START)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });
});

describe('GET /api/mobile/fitments/:fid', () => {
  it('my fitment 200; someone else’s or a deleted task’s 404', async () => {
    const w = await routeWorld();
    const mine = await w.fitment('A', at(TODAY, 9));
    const theirs = await w.fitment('B', at(TODAY, 9), { technician: w.techB });
    const res = await w.api().get(`/api/mobile/fitments/${mine.id}`).set(bearer(w.techA));
    expect(res.status).toBe(200);
    expect(res.body as MyFitmentDto).toMatchObject({ id: mine.id, tkId: tk(mine), taskId: mine.taskId, site: { name: 'Site A', lat: 12.9, lng: 77.6 } });
    expect((await w.api().get(`/api/mobile/fitments/${theirs.id}`).set(bearer(w.techA))).status).toBe(404);
    expect((await w.api().get('/api/mobile/fitments/nope').set(bearer(w.techA))).status).toBe(404);
    await prisma.task.update({ where: { id: mine.taskId }, data: { deletedAt: new Date() } });
    expect((await w.api().get(`/api/mobile/fitments/${mine.id}`).set(bearer(w.techA))).status).toBe(404);
  });
});

describe('OE assignee (D-158)', () => {
  const assign = (w: Awaited<ReturnType<typeof routeWorld>>, actor: User, f: { id: string; taskId: string }, technicianId: string) =>
    w.api().post(`/api/tasks/${f.taskId}/assign`).set(bearer(actor)).send({ fitmentIds: [f.id], technicianId });

  it('an OE assigns a fitment of their own task to themselves, not of another OE’s task, nor to another OE', async () => {
    const w = await routeWorld();
    const otherOe = await createUser({ role: 'OE', managerId: w.om.id });
    const own = await w.fitment('A', at(TODAY, 9), { technician: null, status: 'OPEN' });
    const foreign = await w.fitment('B', at(TODAY, 9), { technician: null, status: 'OPEN', oe: otherOe });
    const res = await assign(w, w.oe, own, w.oe.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body as TaskDto).fitments[0]).toMatchObject({ status: 'ASSIGNED', technician: { id: w.oe.id } });
    expect((await assign(w, w.oe, foreign, w.oe.id)).status).toBe(403); // not their task at all
    const toOther = await assign(w, w.oe, own, otherOe.id);
    expect(toOther.status).toBe(400);
    expect(toOther.body.error.code).toBe('VALIDATION_ERROR');
    expect(toOther.body.error.message).toBe('An operation executive can assign fitments only to an OT or to themselves');
  });

  it('SA and OM assign to any active OE; an inactive OE or an RO is refused; options list the OEs', async () => {
    const w = await routeWorld();
    const otherOe = await createUser({ role: 'OE', managerId: w.om.id });
    const inactiveOe = await createUser({ role: 'OE', managerId: w.om.id, status: 'INACTIVE' });
    const f = await w.fitment('A', at(TODAY, 9), { technician: null, status: 'OPEN' });
    expect((await assign(w, w.om, f, otherOe.id)).status).toBe(200);
    expect((await assign(w, w.sa, f, w.oe.id)).status).toBe(200);
    const inactive = await assign(w, w.om, f, inactiveOe.id);
    expect(inactive.status).toBe(400);
    expect(inactive.body.error.code).toBe('INACTIVE_REFERENCE');
    const ro = await assign(w, w.om, f, w.ro.id);
    expect(ro.status).toBe(400);
    expect(ro.body.error.code).toBe('INVALID_REFERENCE');

    const options = async (user: User) => ((await w.api().get('/api/tasks/options').set(bearer(user))).body as TaskOptionsResponse).assignableOes;
    expect((await options(w.om)).map((o) => o.id).sort()).toEqual([w.oe.id, otherOe.id].sort());
    expect(await options(w.oe)).toEqual([{ id: w.oe.id, name: w.oe.name }]);
    expect(await options(w.ro)).toEqual([]);
  });

  it('an assigned OE starts, closes and marks faulty from the app; an unassigned OE cannot', async () => {
    const w = await routeWorld();
    const f1 = await w.fitment('A', at(TODAY, 9), { technician: w.oe });
    const f2 = await w.fitment('B', at(TODAY, 10), { technician: w.oe });
    const f3 = await w.fitment('C', at(TODAY, 11), { technician: w.techA });
    const r = (await w.route(w.oe)).body as DayRouteDto;
    expect(r.stops).toHaveLength(2);
    expect(r.stops[0]!.fitment.availableActions).toEqual(['START', 'CLOSE_NOT_DONE', 'MARK_FAULTY']);
    const [next, later] = r.stops.map((s) => s.fitment.id) as [string, string];

    expect((await w.transition(w.oe, next, 'START', w.START)).status).toBe(200);
    expect((await w.transition(w.oe, next, 'CLOSE_NOT_DONE', w.close)).status).toBe(200);
    expect((await w.transition(w.oe, later, 'MARK_FAULTY', { reason: 'Dead unit' })).status).toBe(200);
    expect([f1.id, f2.id].sort()).toEqual([next, later].sort());
    // The task's OE, not assigned to f3, can't do its technician steps.
    expect((await w.transition(w.oe, f3.id, 'START', w.START)).status).toBe(403);
  });
});
