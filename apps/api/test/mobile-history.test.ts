import { describe, expect, it } from 'vitest';
import {
  istDayStart,
  mobileDateOptions,
  type ApproveVisitDetailDto,
  type ApproveVisitListResponse,
  type DayHistoryDto,
  type FitmentStatus,
  type MobileHomeResponse,
  type ReporteesHistoryResponse,
  type TaskDto,
} from '@champ/shared';
import { StubRouter, haversineM } from '../src/lib/router';
import { prisma, type User } from '../src/lib/prisma';
import { bearer, createLookup, createTaskWorld, createUser, fakeGoogle, fillSubmitReady, testApi } from './helpers';

// F12: day history with distance, direct reportees and Approve visit (spec §7).
const [TODAY, YESTERDAY] = mobileDateOptions(new Date()) as [string, string];
const HOUR = 3_600_000;
const at = (day: string, hours: number) => new Date(istDayStart(day)!.getTime() + hours * HOUR);
const tk = (f: { tkNo: number }) => `TK-${String(f.tkNo).padStart(5, '0')}`;

async function historyWorld() {
  const w = await createTaskWorld();
  const stub = new StubRouter();
  const api = () => testApi(fakeGoogle(null), { router: stub });
  const closeReason = await createLookup('CLOSE_REASON', 'Client not available');
  const site = (name: string, lat: number) =>
    prisma.clientSite.create({
      data: { clientId: w.client.id, name, nameKey: name.toLowerCase(), address: `${name} road`, lat, lng: 77.6, locationId: w.location.id },
    });
  const sites = { A: await site('Site A', 12.9), B: await site('Site B', 12.95), C: await site('Site C', 13.1) };
  const pos = (key: keyof typeof sites) => ({ startLat: sites[key].lat, startLng: sites[key].lng });

  /** One task with one fitment at `siteKey` (fitment time `fitmentAt`, default 9:00 today), as `data` says. */
  const fitment = async (
    siteKey: keyof typeof sites,
    data: Record<string, unknown> & { status?: FitmentStatus },
    opts: { technician?: User | null; oe?: User; fitmentAt?: Date } = {},
  ) => {
    const res = await api()
      .post('/api/tasks')
      .set(bearer(w.om))
      .send(w.taskBody({ siteId: sites[siteKey].id, vehicles: { entry: 'COUNT', count: 1 }, ...(opts.oe && { oeId: opts.oe.id }) }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const task = res.body as TaskDto;
    await prisma.task.update({ where: { id: task.id }, data: { fitmentAt: opts.fitmentAt ?? at(TODAY, 9) } });
    const technician = opts.technician === undefined ? w.techA : opts.technician;
    return prisma.fitment.update({
      where: { id: task.fitments[0]!.id },
      data: { technicianId: technician?.id ?? null, status: 'ASSIGNED', ...data },
    });
  };
  const history = (user: User, query: Record<string, unknown> = { date: TODAY }) => api().get('/api/mobile/history').query(query).set(bearer(user));
  const reportees = (user: User, date = TODAY) => api().get('/api/mobile/history/reportees').query({ date }).set(bearer(user));
  return { ...w, stub, api, sites, pos, fitment, history, reportees, closeReason };
}

describe('GET /api/mobile/history', () => {
  it("day selection: fitments with a step on the day, only that day's steps, ordered by first step", async () => {
    const w = await historyWorld();
    const done = await w.fitment('A', { status: 'SUBMITTED', startedAt: at(TODAY, 9), ...w.pos('A'), submittedAt: at(TODAY, 10) });
    const carried = await w.fitment('B', { status: 'SUBMITTED', startedAt: at(YESTERDAY, 15), ...w.pos('B'), submittedAt: at(TODAY, 8) });
    const closed = await w.fitment('C', { status: 'CLOSED_NOT_DONE', closedAt: at(TODAY, 11), closeReasonId: w.closeReason.id });
    await w.fitment('C', { status: 'IN_PROGRESS', startedAt: at(YESTERDAY, 10), ...w.pos('C') }); // nothing today
    await w.fitment('A', { status: 'IN_PROGRESS', startedAt: at(TODAY, 9) }, { technician: w.techB }); // someone else's
    await w.fitment('A', { status: 'ASSIGNED' }); // no step at all

    const res = await w.history(w.techA);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const h = res.body as DayHistoryDto;
    expect(h).toMatchObject({ date: TODAY, user: { id: w.techA.id, name: 'Arjun Tech', role: 'OT' }, startedCount: 1, distanceM: 0, approx: false });
    expect(h.entries.map((e) => e.tkId)).toEqual([tk(carried), tk(done), tk(closed)]);
    const [c, d, x] = h.entries as [DayHistoryDto['entries'][number], DayHistoryDto['entries'][number], DayHistoryDto['entries'][number]];
    expect(c).toMatchObject({ started: false, legFromPreviousM: null, steps: [{ kind: 'SUBMITTED', label: 'Submitted', at: at(TODAY, 8).toISOString() }] });
    expect(d).toMatchObject({ started: true, legFromPreviousM: null, customer: 'Zoomcar', site: { name: 'Site A', address: 'Site A road' } });
    expect(d.steps.map((s) => s.kind)).toEqual(['STARTED', 'SUBMITTED']);
    expect(x).toMatchObject({ started: false, status: 'CLOSED_NOT_DONE', steps: [{ kind: 'CLOSED_NOT_DONE', label: 'Closed – not done: Client not available' }] });
    expect(w.stub.routeCalls).toHaveLength(0);
  });

  it('distance: one route request in start order, same-site and < 50 m merged, no-coordinate starts skipped; cached by signature', async () => {
    const w = await historyWorld();
    const a = await w.fitment('A', { status: 'SUBMITTED', startedAt: at(TODAY, 9), ...w.pos('A') });
    const a2 = await w.fitment('A', { status: 'SUBMITTED', startedAt: at(TODAY, 9.5), startLat: 12.9004, startLng: 77.6 }); // same site, 44 m
    const c = await w.fitment('C', { status: 'IN_PROGRESS', startedAt: at(TODAY, 12), ...w.pos('C') });
    const b = await w.fitment('B', { status: 'SUBMITTED', startedAt: at(TODAY, 10), ...w.pos('B') });
    const blind = await w.fitment('B', { status: 'IN_PROGRESS', startedAt: at(TODAY, 11) });

    const h = (await w.history(w.techA)).body as DayHistoryDto;
    expect(w.stub.routeCalls).toEqual([[{ lat: 12.9, lng: 77.6 }, { lat: 12.95, lng: 77.6 }, { lat: 13.1, lng: 77.6 }]]);
    const ab = Math.round(Math.round(haversineM(w.sites.A, w.sites.B)) * 1.5);
    const bc = Math.round(Math.round(haversineM(w.sites.B, w.sites.C)) * 1.5);
    expect(h).toMatchObject({ startedCount: 5, approx: false, distanceM: ab + bc });
    expect(h.entries.map((e) => [e.tkId, e.legFromPreviousM])).toEqual([
      [tk(a), null],
      [tk(a2), 0],
      [tk(b), ab],
      [tk(blind), null],
      [tk(c), bc],
    ]);
    expect(await prisma.dayDistance.count()).toBe(1);

    expect(((await w.history(w.techA)).body as DayHistoryDto).distanceM).toBe(ab + bc);
    expect(w.stub.routeCalls).toHaveLength(1); // cache hit

    await w.fitment('A', { status: 'IN_PROGRESS', startedAt: at(TODAY, 13), ...w.pos('A') });
    const more = (await w.history(w.techA)).body as DayHistoryDto;
    expect(w.stub.routeCalls).toHaveLength(2); // signature changed
    expect(w.stub.routeCalls[1]).toHaveLength(4);
    expect(more.distanceM).toBeGreaterThan(ab + bc);
    expect(await prisma.dayDistance.count()).toBe(1);
  });

  it('falls back to straight lines (approx), keeps it for 10 min, then retries the router', async () => {
    const w = await historyWorld();
    w.stub.fail = true;
    await w.fitment('A', { status: 'SUBMITTED', startedAt: at(TODAY, 9), ...w.pos('A') });
    await w.fitment('C', { status: 'SUBMITTED', startedAt: at(TODAY, 10), ...w.pos('C') });
    const straight = Math.round(haversineM(w.sites.A, w.sites.C));

    let h = (await w.history(w.techA)).body as DayHistoryDto;
    expect(h).toMatchObject({ approx: true, distanceM: straight });
    await w.history(w.techA);
    expect(w.stub.routeCalls).toHaveLength(1);

    w.stub.fail = false;
    await prisma.dayDistance.updateMany({ data: { computedAt: new Date(Date.now() - 11 * 60_000) } });
    h = (await w.history(w.techA)).body as DayHistoryDto;
    expect(w.stub.routeCalls).toHaveLength(2);
    expect(h).toMatchObject({ approx: false, distanceM: Math.round(straight * 1.5) });
  });

  it('access: self, OE to a direct reportee (even inactive), else 403; dates validated', async () => {
    const w = await historyWorld();
    await w.fitment('A', { status: 'IN_PROGRESS', startedAt: at(TODAY, 9), ...w.pos('A') });
    expect((await w.history(w.techA, { date: TODAY, userId: w.techA.id })).status).toBe(200);
    const asOe = await w.history(w.oe, { date: TODAY, userId: w.techA.id });
    expect(asOe.status).toBe(200);
    expect(asOe.body).toMatchObject({ user: { id: w.techA.id, name: 'Arjun Tech' }, startedCount: 1 });
    expect((await w.history(w.oe)).body).toMatchObject({ user: { id: w.oe.id, role: 'OE' }, startedCount: 0 });

    await prisma.user.update({ where: { id: w.techB.id }, data: { status: 'INACTIVE' } });
    expect((await w.history(w.oe, { date: TODAY, userId: w.techB.id })).status).toBe(200);

    const otherOe = await createUser({ role: 'OE', managerId: w.om.id });
    const stranger = await createUser({ role: 'OT', managerId: otherOe.id });
    expect((await w.history(w.oe, { date: TODAY, userId: stranger.id })).status).toBe(403);
    expect((await w.history(w.oe, { date: TODAY, userId: w.om.id })).status).toBe(403);
    expect((await w.history(w.techA, { date: TODAY, userId: w.techB.id })).status).toBe(403);
    expect((await w.history(w.om)).status).toBe(403);
    expect((await w.history(w.techA, { date: '2020-01-01' })).status).toBe(400);
  });
});

describe('GET /api/mobile/history/reportees', () => {
  it('OE only; active direct reportees by name with counts; straight lines until a routed value is cached, never routing', async () => {
    const w = await historyWorld();
    expect((await w.reportees(w.techA)).status).toBe(403);
    await w.fitment('A', { status: 'SUBMITTED', startedAt: at(TODAY, 9), ...w.pos('A') });
    await w.fitment('C', { status: 'IN_PROGRESS', startedAt: at(TODAY, 10), ...w.pos('C') });
    await w.fitment('B', { status: 'IN_PROGRESS', startedAt: at(TODAY, 9), ...w.pos('B') }, { technician: w.techB });
    await w.fitment('B', { status: 'CLOSED_NOT_DONE', closedAt: at(TODAY, 9), closeReasonId: w.closeReason.id }, { technician: w.techB });
    await createUser({ role: 'OT', managerId: w.oe.id, status: 'INACTIVE', name: 'Aaron Gone' });
    const straight = Math.round(haversineM(w.sites.A, w.sites.C));

    let res = await w.reportees(w.oe);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    let r = res.body as ReporteesHistoryResponse;
    expect(r.date).toBe(TODAY);
    expect(r.items.map((i) => [i.user.name, i.startedCount, i.distanceM, i.approx])).toEqual([
      ['Arjun Tech', 2, straight, true],
      ['Bhavna Tech', 1, 0, false],
      [w.ot.name, 0, 0, false],
    ]);

    expect((await w.history(w.oe, { date: TODAY, userId: w.techA.id })).body).toMatchObject({ approx: false, distanceM: Math.round(straight * 1.5) });
    expect(w.stub.routeCalls).toHaveLength(1);
    r = (await w.reportees(w.oe)).body as ReporteesHistoryResponse;
    expect(r.items[0]).toMatchObject({ distanceM: Math.round(straight * 1.5), approx: false });
    expect(w.stub.routeCalls).toHaveLength(1);

    res = await w.reportees(w.oe, YESTERDAY);
    expect((res.body as ReporteesHistoryResponse).items.every((i) => i.startedCount === 0)).toBe(true);
  });
});

describe('Approve visit', () => {
  async function approveWorld() {
    const w = await historyWorld();
    const otherOe = await createUser({ role: 'OE', managerId: w.om.id });
    const late = await w.fitment('A', { status: 'SUBMITTED', submittedAt: at(TODAY, 12), vehicleRegNo: 'KA01AB1234' });
    const early = await w.fitment('B', { status: 'SUBMITTED', submittedAt: at(TODAY, 10) });
    await w.fitment('C', { status: 'SUBMITTED', submittedAt: at(TODAY, 11) }, { oe: otherOe });
    await w.fitment('C', { status: 'SUBMITTED', submittedAt: at(YESTERDAY, 11) }, { fitmentAt: at(YESTERDAY, 9) });
    await w.fitment('C', { status: 'IN_PROGRESS', startedAt: at(TODAY, 9) });
    const list = (user: User, date = TODAY) => w.api().get('/api/mobile/approve-visit').query({ date }).set(bearer(user));
    const detail = (user: User, fid: string) => w.api().get(`/api/mobile/approve-visit/${fid}`).set(bearer(user));
    return { ...w, otherOe, late, early, list, detail };
  }

  it("lists the OE's Submitted fitments of the day by submit time, matching the home count", async () => {
    const w = await approveWorld();
    const res = await w.list(w.oe);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.body as ApproveVisitListResponse;
    expect(body.items.map((i) => i.tkId)).toEqual([tk(w.early), tk(w.late)]);
    expect(body.items[1]).toMatchObject({
      customer: 'Zoomcar',
      site: { name: 'Site A', address: 'Site A road' },
      technician: { id: w.techA.id, name: 'Arjun Tech' },
      vehicleRegNo: 'KA01AB1234',
      submittedAt: at(TODAY, 12).toISOString(),
    });
    const home = (await w.api().get('/api/mobile/home').query({ date: TODAY }).set(bearer(w.oe))).body as MobileHomeResponse;
    expect(home.approveVisit).toBe(body.items.length);
    for (const day of [YESTERDAY]) {
      const h = (await w.api().get('/api/mobile/home').query({ date: day }).set(bearer(w.oe))).body as MobileHomeResponse;
      expect(h.approveVisit).toBe(((await w.list(w.oe, day)).body as ApproveVisitListResponse).items.length);
    }
    expect(((await w.list(w.otherOe)).body as ApproveVisitListResponse).items).toHaveLength(1);
    expect((await w.list(w.techA)).status).toBe(403);
  });

  it("detail: form, photos and verification for the task's OE; 404 for another OE's task; OT 403", async () => {
    const w = await approveWorld();
    await fillSubmitReady(w.early.id);
    const res = await w.detail(w.oe, w.early.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const d = res.body as ApproveVisitDetailDto;
    expect(d).toMatchObject({ status: 'SUBMITTED', isVehicle: true, availableActions: ['VERIFY', 'REOPEN'], item: { tkId: tk(w.early) } });
    expect(d.form).toMatchObject({ deviceId: 'DEV-TEST', clusterReadingKm: 1000 });
    expect(d.photos.map((p) => p.kind).sort()).toEqual(['AFTER', 'ASSET', 'BEFORE', 'CLUSTER']);
    expect(d.verification).toMatchObject({ issueObserved: null, actionTaken: null, finalIssue: null, accessories: [] });
    expect((await w.detail(w.otherOe, w.early.id)).status).toBe(404);
    expect((await w.detail(w.oe, 'nope')).status).toBe(404);
    expect((await w.detail(w.techA, w.early.id)).status).toBe(403);
  });

  it('VERIFY and REOPEN by a mobile token go through the existing transitions endpoint', async () => {
    const w = await approveWorld();
    const step = (fid: string, action: string, payload: unknown) =>
      w.api().post(`/api/fitments/${fid}/transitions`).set(bearer(w.oe)).send({ action, payload });
    const verified = await step(w.early.id, 'VERIFY', w.verification);
    expect(verified.status, JSON.stringify(verified.body)).toBe(200);
    const reopened = await step(w.late.id, 'REOPEN', { reason: 'Photos are blurred' });
    expect(reopened.status, JSON.stringify(reopened.body)).toBe(200);
    expect(((await w.list(w.oe)).body as ApproveVisitListResponse).items).toEqual([]);
    const d = (await w.detail(w.oe, w.early.id)).body as ApproveVisitDetailDto;
    expect(d).toMatchObject({ status: 'OE_VERIFIED', verification: { finalIssue: { id: w.billableIssue.id }, billable: true } });
    expect(d.availableActions).toEqual(['REOPEN']);
  });
});
