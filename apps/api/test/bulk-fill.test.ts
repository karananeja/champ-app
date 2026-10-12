import { describe, expect, it } from 'vitest';
import {
  BULK_FILL_COLUMNS,
  mobileDateOptions,
  type BulkFillConfirmResponse,
  type BulkFillPreviewResponse,
  type BulkFillTaskDto,
  type DayRouteDto,
  type FitmentStatus,
  type SubmitReadyResponse,
  type TaskDto,
} from '@champ/shared';
import { StubRouter } from '../src/lib/router';
import { prisma, type User } from '../src/lib/prisma';
import { bearer, createTaskWorld, createUser, fakeGoogle, fillSubmitReady, testApi } from './helpers';

// F11: mobile CSV bulk fill (spec §7).
const [TODAY] = mobileDateOptions(new Date()) as [string];
const GPS = { lat: 12.97, lng: 77.59 };
const api = () => testApi(fakeGoogle(null), { router: new StubRouter() });
const tk = (f: { tkNo: number }) => `TK-${String(f.tkNo).padStart(5, '0')}`;
const HEADER = BULK_FILL_COLUMNS.join(',');

/** CSV text from rows of `{ column: value }` (header = all columns). */
const csv = (rows: Record<string, string>[], header: readonly string[] = BULK_FILL_COLUMNS) =>
  [header.join(','), ...rows.map((r) => header.map((c) => r[c] ?? '').join(','))].join('\r\n');

async function bulkWorld(opts: { count?: number; statuses?: FitmentStatus[] } = {}) {
  const w = await createTaskWorld();
  const count = opts.count ?? 3;
  const created = await api().post('/api/tasks').set(bearer(w.om)).send(w.taskBody({ vehicles: { entry: 'COUNT', count } }));
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const taskId = (created.body as TaskDto).id;
  await prisma.task.update({ where: { id: taskId }, data: { fitmentAt: new Date() } });
  const rows = await prisma.fitment.findMany({ where: { taskId }, orderBy: { seq: 'asc' } });
  for (const [i, f] of rows.entries()) {
    await prisma.fitment.update({ where: { id: f.id }, data: { technicianId: w.techA.id, status: opts.statuses?.[i] ?? 'ASSIGNED' } });
  }
  const fitments = await prisma.fitment.findMany({ where: { taskId }, orderBy: { seq: 'asc' } });
  const base = `/api/mobile/tasks/${taskId}`;
  const get = (u: User) => api().get(`${base}/bulk-fill`).set(bearer(u));
  const sample = (u: User) => api().get(`${base}/bulk-fill/sample.csv`).set(bearer(u));
  const preview = (u: User, text: string | Buffer, name = 'fill.csv') =>
    api().post(`${base}/bulk-fill/preview`).set(bearer(u)).attach('file', Buffer.isBuffer(text) ? text : Buffer.from(text), name);
  const confirm = (u: User, body: object) => api().post(`${base}/bulk-fill/confirm`).set(bearer(u)).send(body);
  const submitReady = (u: User) => api().post(`${base}/submit-ready`).set(bearer(u));
  const events = (fitmentId: string, type: string) => prisma.taskEvent.findMany({ where: { fitmentId, type } });
  const reload = (id: string) => prisma.fitment.findUniqueOrThrow({ where: { id } });
  return { ...w, taskId, fitments, get, sample, preview, confirm, submitReady, events, reload };
}

/** Another task today at another site with one fitment of tech A. */
async function otherTask(w: Awaited<ReturnType<typeof bulkWorld>>, status: FitmentStatus = 'ASSIGNED') {
  const res = await api()
    .post('/api/tasks')
    .set(bearer(w.om))
    .send(w.taskBody({ siteId: w.client.sites[1]!.id, vehicles: { entry: 'COUNT', count: 1 } }));
  const task = res.body as TaskDto;
  await prisma.task.update({ where: { id: task.id }, data: { fitmentAt: new Date() } });
  return prisma.fitment.update({ where: { id: task.fitments[0]!.id }, data: { technicianId: w.techA.id, status } });
}

/** Stores the day route in this order (the set must be tech A's open fitments today). */
async function storeRoute(w: Awaited<ReturnType<typeof bulkWorld>>, ids: string[]) {
  const res = await api().get('/api/mobile/route').query({ date: TODAY, ...GPS }).set(bearer(w.techA));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  await prisma.dayRoute.updateMany({ where: { technicianId: w.techA.id }, data: { fitmentIds: ids } });
}

const dayRoute = async (w: Awaited<ReturnType<typeof bulkWorld>>) =>
  (await api().get('/api/mobile/route').query({ date: TODAY, ...GPS }).set(bearer(w.techA))).body as DayRouteDto;

describe('GET /mobile/tasks/:taskId/bulk-fill', () => {
  it("lists only the caller's fitments by seq with what is missing; 404 without fitments", async () => {
    const w = await bulkWorld({ statuses: ['ASSIGNED', 'IN_PROGRESS', 'ASSIGNED'] });
    await prisma.fitment.update({ where: { id: w.fitments[2]!.id }, data: { technicianId: w.techB.id } });
    await fillSubmitReady(w.fitments[1]!.id);
    await prisma.fitmentPhoto.deleteMany({ where: { fitmentId: w.fitments[1]!.id, kind: 'AFTER' } });

    const res = await w.get(w.techA);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.body as BulkFillTaskDto;
    expect(body).toMatchObject({ taskId: w.taskId, omId: expect.stringMatching(/^OM-/), customer: 'Zoomcar', site: { name: 'Bengaluru depot' } });
    expect(body.fitments.map((f) => f.fitment.id)).toEqual([w.fitments[0]!.id, w.fitments[1]!.id]);
    expect(body.fitments[0]!.fitment.taskFitmentCount).toBe(2);
    expect(body.fitments[0]!.missingPhotos).toEqual(['BEFORE', 'ASSET', 'CLUSTER', 'AFTER']);
    expect(body.fitments[0]!.missing).toContain('CAN voltage');
    expect(body.fitments[1]).toMatchObject({ missing: ['After photo'], missingPhotos: ['AFTER'] });

    const stranger = await createUser({ role: 'OT', managerId: w.oe.id });
    expect((await w.get(stranger)).status).toBe(404);
    expect((await w.get(w.om)).status).toBe(403);
    expect((await w.get(w.techB)).status).toBe(200); // techB has one fitment there
  });
});

describe('GET /mobile/tasks/:taskId/bulk-fill/sample.csv', () => {
  it('has the header and one row per fillable fitment with reg/chassis, as an attachment', async () => {
    const w = await bulkWorld({ statuses: ['ASSIGNED', 'OE_VERIFIED', 'IN_PROGRESS'] });
    await prisma.fitment.update({ where: { id: w.fitments[0]!.id }, data: { vehicleRegNo: 'KA01AB1234', chassisNo: 'CH-1' } });
    const res = await w.sample(w.techA);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="?bulk-fill-OM-\d{5}\.csv"?$/);
    const text = res.text;
    expect(text.startsWith('﻿')).toBe(true);
    const lines = text.slice(1).trimEnd().split('\r\n');
    expect(lines[0]).toBe(HEADER);
    expect(lines.slice(1)).toEqual([`${tk(w.fitments[0]!)},KA01AB1234,CH-1,,,,,,,,,,`, `${tk(w.fitments[2]!)},,,,,,,,,,,,`]);
  });
});

describe('POST /mobile/tasks/:taskId/bulk-fill/preview', () => {
  it('refuses bad files: no tk_id column, empty, too many rows, binary', async () => {
    const w = await bulkWorld({ count: 2 });
    const cases: [string | Buffer, RegExp][] = [
      ['vehicle_reg_no\r\nKA01', /tk_id/],
      [HEADER, /no fitment rows/],
      [[HEADER, ...Array.from({ length: 501 }, () => 'TK-1')].join('\n'), /At most 500 rows/],
      [Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]), /binary/],
    ];
    for (const [file, message] of cases) {
      const res = await w.preview(w.techA, file);
      expect(res.status, String(message)).toBe(400);
      expect(res.body.error).toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringMatching(message), details: { fieldErrors: { file: [expect.any(String)] } } });
    }
  });

  it('refuses a stranger before reading the file (404) and web roles (403)', async () => {
    const w = await bulkWorld({ count: 2 });
    const stranger = await createUser({ role: 'OT', managerId: w.oe.id });
    expect((await w.preview(stranger, 'not even a csv')).status).toBe(404);
    expect((await w.preview(w.om, HEADER)).status).toBe(403);
  });

  it('checks every row', async () => {
    const w = await bulkWorld({ count: 7, statuses: ['ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'OE_VERIFIED', 'CLOSED_NOT_DONE', 'IN_PROGRESS', 'SUBMITTED'] });
    const [assigned, inProgress, submitted, verified, closed, mineB, dup] = w.fitments as [typeof w.fitments[number], ...typeof w.fitments];
    await prisma.fitment.update({ where: { id: mineB!.id }, data: { technicianId: w.techB.id } });
    const outsider = await otherTask(w);
    const text = csv([
      { tk_id: tk(assigned) }, // 2: nothing to fill, but will start
      { tk_id: String(inProgress!.tkNo), device_id: 'dev-9', can_voltage: 'n/a', cluster_reading_km: '"1,200"' }, // 3
      { tk_id: tk(submitted!) }, // 4: nothing to fill
      { tk_id: tk(verified!), comments: 'x' }, // 5
      { tk_id: tk(closed!), comments: 'x' }, // 6
      { tk_id: tk(mineB!), comments: 'x' }, // 7
      { tk_id: tk(outsider), comments: 'x' }, // 8
      { tk_id: 'TK-99999999', comments: 'x' }, // 9
      { tk_id: 'hello', comments: 'x' }, // 10
      { tk_id: tk(dup!), comments: 'dup', accessories: 'nto ok' }, // 11
      { tk_id: tk(dup!).toLowerCase(), comments: 'dup' }, // 12
    ]);
    const res = await w.preview(w.techA, text);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.body as BulkFillPreviewResponse;
    const row = (n: number) => body.rows.find((r) => r.rowNumber === n)!;
    expect(row(2)).toMatchObject({ valid: true, willStart: true, fitmentId: assigned.id, form: {} });
    expect(row(3)).toMatchObject({ valid: true, willStart: false, form: { deviceId: 'DEV-9', checks: { canVoltage: 'NA' }, clusterReadingKm: 1200 } });
    expect(row(4).errors).toEqual([{ column: '', message: 'Nothing to fill' }]);
    expect(row(5).errors).toEqual([{ column: '', message: 'Already verified — read only' }]);
    expect(row(6).errors).toEqual([{ column: '', message: 'This fitment is Closed – not done' }]);
    expect(row(7).errors).toEqual([{ column: 'tk_id', message: `${tk(mineB!)} is not assigned to you` }]);
    expect(row(8).errors).toEqual([{ column: 'tk_id', message: `${tk(outsider)} is not a fitment of this task` }]);
    expect(row(9).errors[0]!.message).toMatch(/not a fitment of this task/);
    expect(row(10).errors[0]!.message).toMatch(/is not a TK id/);
    expect(row(11).errors).toEqual([
      { column: 'tk_id', message: `${tk(dup!)} appears more than once in the file` },
      { column: 'accessories', message: 'Accessories: Use OK, Not OK or NA' },
    ]);
    expect(row(12).valid).toBe(false);
    expect(body).toMatchObject({ validCount: 2, invalidCount: 9, startCount: 1 });
    // Nothing written.
    expect((await w.reload(inProgress!.id)).deviceId).toBeNull();
  });
});

describe('POST /mobile/tasks/:taskId/bulk-fill/confirm', () => {
  it('starts Assigned fitments with one fix, fills, keeps blanks (D-205) and writes one "Filled from CSV" event', async () => {
    const w = await bulkWorld({ count: 3, statuses: ['ASSIGNED', 'IN_PROGRESS', 'REOPENED'] });
    const [a, b, c] = w.fitments as [typeof w.fitments[number], typeof w.fitments[number], typeof w.fitments[number]];
    await prisma.fitment.update({ where: { id: b.id }, data: { deviceId: 'OLD', chassisNo: 'KEEP' } });
    await storeRoute(w, [c.id, a.id, b.id]);
    const res = await w.confirm(w.techA, {
      ...GPS,
      rows: [
        { rowNumber: 4, tkId: tk(c), form: {} },
        { rowNumber: 3, tkId: tk(b), form: { deviceId: 'new-1', checks: { accessories: 'OK' } } },
        { rowNumber: 2, tkId: tk(a), form: { vehicleRegNo: 'KA01AB1234' } },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body as BulkFillConfirmResponse).toEqual({ filled: [tk(a), tk(b), tk(c)], started: [tk(a), tk(c)], failed: [] });
    const [ra, rb, rc] = await Promise.all([a, b, c].map((f) => w.reload(f.id)));
    expect(ra).toMatchObject({ status: 'IN_PROGRESS', vehicleRegNo: 'KA01AB1234', startLat: GPS.lat, startLng: GPS.lng });
    expect(rb).toMatchObject({ status: 'IN_PROGRESS', deviceId: 'NEW-1', chassisNo: 'KEEP', checks: { accessories: 'OK' } });
    expect(rb!.formUpdatedAt).not.toBeNull();
    expect(rc!.status).toBe('IN_PROGRESS');
    expect(await w.events(a.id, 'FITMENT_STARTED')).toHaveLength(1);
    const filled = await w.events(b.id, 'FITMENT_FORM_CSV_FILLED');
    expect(filled).toHaveLength(1);
    expect(filled[0]!.data).toEqual({ tkId: tk(b), 'Device id': ['OLD', 'NEW-1'], Accessories: [null, 'OK'] });
    expect(await w.events(c.id, 'FITMENT_FORM_CSV_FILLED')).toHaveLength(0); // nothing changed
  });

  it('GPS_REQUIRED when a row needs starting and no fix: nothing written', async () => {
    const w = await bulkWorld({ count: 2, statuses: ['ASSIGNED', 'IN_PROGRESS'] });
    const res = await w.confirm(w.techA, {
      rows: [
        { rowNumber: 2, tkId: tk(w.fitments[0]!), form: { deviceId: 'A' } },
        { rowNumber: 3, tkId: tk(w.fitments[1]!), form: { deviceId: 'B' } },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'GPS_REQUIRED', message: 'Turn on location to start the fitments' });
    expect((await w.reload(w.fitments[1]!.id)).deviceId).toBeNull();
    expect((await w.reload(w.fitments[0]!.id)).status).toBe('ASSIGNED');
  });

  it('a stale row (verified in between) fails alone; route order still enforced across tasks', async () => {
    const w = await bulkWorld({ count: 3, statuses: ['SUBMITTED', 'IN_PROGRESS', 'ASSIGNED'] });
    const [a, b, c] = w.fitments as [typeof w.fitments[number], typeof w.fitments[number], typeof w.fitments[number]];
    await prisma.fitment.update({ where: { id: a.id }, data: { status: 'OE_VERIFIED' } }); // after the preview
    const other = await otherTask(w);
    await storeRoute(w, [other.id, b.id, c.id]);
    const res = await w.confirm(w.techA, {
      ...GPS,
      rows: [
        { rowNumber: 2, tkId: tk(a), form: { deviceId: 'A' } },
        { rowNumber: 3, tkId: tk(b), form: { deviceId: 'B' } },
        { rowNumber: 4, tkId: tk(c), form: { deviceId: 'C' } },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.body as BulkFillConfirmResponse;
    expect(body.filled).toEqual([tk(b)]);
    expect(body.started).toEqual([]);
    expect(body.failed).toEqual([
      { rowNumber: 2, tkId: tk(a), code: 'FITMENT_LOCKED', message: 'Already verified — read only' },
      { rowNumber: 4, tkId: tk(c), code: 'ROUTE_ORDER', message: `Finish or close ${tk(other)} first` },
    ]);
    // The refused START rolled back the fill too.
    expect(await w.reload(c.id)).toMatchObject({ status: 'ASSIGNED', deviceId: null });
  });

  it('validates the body', async () => {
    const w = await bulkWorld({ count: 2 });
    expect((await w.confirm(w.techA, { rows: [] })).status).toBe(400);
    expect((await w.confirm(w.techA, { rows: [{ rowNumber: 2, tkId: 'x', form: {} }], lat: 1 })).status).toBe(400);
  });
});

describe('route order within a task (D-202)', () => {
  it('same-task fitments never block; other tasks still do; the day route agrees', async () => {
    const w = await bulkWorld({ count: 3, statuses: ['IN_PROGRESS', 'ASSIGNED', 'ASSIGNED'] });
    const [a, b, c] = w.fitments as [typeof w.fitments[number], typeof w.fitments[number], typeof w.fitments[number]];
    const other = await otherTask(w);
    await storeRoute(w, [c.id, other.id, b.id, a.id]);

    const route = await dayRoute(w);
    const stop = (id: string) => route.stops.find((s) => s.fitment.id === id)!;
    expect(stop(a.id)).toMatchObject({ isNext: true, blockedBy: null });
    expect(stop(c.id)).toMatchObject({ isNext: true, blockedBy: null });
    expect(stop(b.id)).toMatchObject({ isNext: false, blockedBy: tk(other) }); // another task's stop comes first
    expect(stop(other.id)).toMatchObject({ isNext: false, blockedBy: tk(a) }); // a is In progress

    const start = (id: string) => api().post(`/api/fitments/${id}/transitions`).set(bearer(w.techA)).send({ action: 'START', payload: GPS });
    expect((await start(c.id)).status).toBe(200);
    const blocked = await start(b.id);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatchObject({ code: 'ROUTE_ORDER', message: `Finish or close ${tk(other)} first` });
    const otherRes = await start(other.id);
    expect(otherRes.status).toBe(409);
    expect(otherRes.body.error.message).toMatch(/^Finish or close TK-/);
  });
});

describe('POST /mobile/tasks/:taskId/submit-ready', () => {
  it('submits complete In-progress fitments, lists incomplete ones and skips others', async () => {
    const w = await bulkWorld({ count: 3, statuses: ['IN_PROGRESS', 'IN_PROGRESS', 'ASSIGNED'] });
    const [a, b, c] = w.fitments as [typeof w.fitments[number], typeof w.fitments[number], typeof w.fitments[number]];
    await fillSubmitReady(a.id);
    await prisma.fitment.update({ where: { id: b.id }, data: { deviceId: 'X' } });
    const res = await w.submitReady(w.techA);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.body as SubmitReadyResponse;
    expect(body.submitted).toEqual([tk(a)]);
    expect(body.skipped).toEqual([tk(c)]);
    expect(body.incomplete).toHaveLength(1);
    expect(body.incomplete[0]).toMatchObject({ tkId: tk(b), missing: expect.arrayContaining(['Before photo', 'CAN voltage']) });
    expect((await w.reload(a.id)).status).toBe('SUBMITTED');
    expect((await w.reload(b.id)).status).toBe('IN_PROGRESS');
    const stranger = await createUser({ role: 'OT', managerId: w.oe.id });
    expect((await w.submitReady(stranger)).status).toBe(404);
  });
});
