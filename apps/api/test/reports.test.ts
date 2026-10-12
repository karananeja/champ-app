import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  istDayStart,
  type AnalyticsResponse,
  type BillingReportResponse,
  type FitmentStatus,
  type TaskDto,
} from '@champ/shared';
import { straightLineRoute } from '../src/lib/router';
import { prisma, type User } from '../src/lib/prisma';
import { sheetNames } from '../src/modules/reports/billing';
import { bearer, createTaskWorld, createUser, testApi } from './helpers';

// F15: billing report and analytics (spec §7).
const HOUR = 3_600_000;
/** An instant at `hours` (may be fractional) after the start of an IST day. */
const at = (day: string, hours: number) => new Date(istDayStart(day)!.getTime() + hours * HOUR);
const api = () => testApi();

const binary = (res: { on: (event: string, cb: (chunk?: Buffer) => void) => void }, done: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c) => chunks.push(c!));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};
const csvLines = (text: string) => text.replace(/^\uFEFF/, '').trim().split('\r\n');

async function reportsWorld() {
  const w = await createTaskWorld();
  const oe2 = await createUser({ role: 'OE', name: 'Zed OE', managerId: w.om.id });
  const techC = await createUser({ role: 'OT', name: 'Chetan Tech', managerId: oe2.id, technicianType: 'PAYROLL', baseLocationId: w.location.id });
  const sites = { blr: w.client.sites[0]!, pune: w.client.sites[1]!, delhi: w.otherClient.sites[0]! };

  /** A task with `count` fitments; created and fitment times fixed. */
  const task = async (opts: { site?: keyof typeof sites; oe?: User; count?: number; createdAt: Date; fitmentAt: Date }) => {
    const site = sites[opts.site ?? 'blr'];
    const res = await api()
      .post('/api/tasks')
      .set(bearer(w.om))
      .send(w.taskBody({ clientId: site.clientId, siteId: site.id, oeId: (opts.oe ?? w.oe).id, vehicles: { entry: 'COUNT', count: opts.count ?? 1 } }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const t = res.body as TaskDto;
    await prisma.task.update({ where: { id: t.id }, data: { createdAt: opts.createdAt, fitmentAt: opts.fitmentAt } });
    return { id: t.id, fitments: t.fitments.map((f) => f.id) };
  };
  const setFitment = (id: string, data: Record<string, unknown> & { status?: FitmentStatus }) => prisma.fitment.update({ where: { id }, data });
  return { ...w, oe2, techC, sites, task, setFitment };
}

// --- Billing ---

describe('GET /api/reports/billing', () => {
  async function billingWorld() {
    const w = await reportsWorld();
    const created = at('2026-09-01', 8);
    const t1 = await task(w, { count: 6, createdAt: created });
    const other = await task(w, { site: 'delhi', count: 1, createdAt: created });
    const deleted = await task(w, { count: 1, createdAt: created });
    await prisma.task.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
    const approved = (approvedAt: Date, billable: boolean | null = true, status: FitmentStatus = 'OM_APPROVED') => ({
      status,
      technicianId: w.techA.id,
      verifiedAt: new Date(approvedAt.getTime() - HOUR),
      approvedAt,
      billable,
      finalIssueId: billable ? w.billableIssue.id : w.freeIssue.id,
      deviceId: 'DEV-1',
      vehicleRegNo: 'KA01AB1234',
    });
    const [lastMinute, nextMonth, firstMinute, free, reopened, notApproved] = t1.fitments as [string, string, string, string, string, string];
    await w.setFitment(lastMinute, approved(at('2026-09-30', 23 + 50 / 60))); // 23:50 IST on the last day: September
    await w.setFitment(nextMonth, approved(at('2026-10-01', 10 / 60))); // 00:10 IST on Oct 1: October
    await w.setFitment(firstMinute, approved(at('2026-09-01', 0)));
    await w.setFitment(free, approved(at('2026-09-10', 12), false));
    await w.setFitment(reopened, approved(at('2026-09-11', 12), true, 'REOPENED'));
    await w.setFitment(notApproved, { status: 'OE_VERIFIED', verifiedAt: at('2026-09-12', 12), billable: true });
    await w.setFitment(other.fitments[0]!, approved(at('2026-09-15', 12)));
    await w.setFitment(deleted.fitments[0]!, approved(at('2026-09-15', 12)));
    return { ...w, lastMinute, firstMinute, otherFitment: other.fitments[0]! };
  }
  const task = (w: Awaited<ReturnType<typeof reportsWorld>>, opts: { site?: 'blr' | 'pune' | 'delhi'; count?: number; createdAt: Date }) =>
    w.task({ ...opts, fitmentAt: opts.createdAt });

  it('lists billable fitments approved in the IST month, grouped by client, with non-billable counts', async () => {
    const w = await billingWorld();
    const res = await api().get('/api/reports/billing').query({ month: '2026-09' }).set(bearer(w.om));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.body as BillingReportResponse;
    expect(body.month).toBe('2026-09');
    expect(body.totals).toEqual({ billable: 3, nonBillable: 1 });
    expect(body.clients.map((c) => [c.client, c.billableCount, c.nonBillableCount])).toEqual([
      ['Other Fleet', 1, 0],
      ['Zoomcar', 2, 1],
    ]);
    const zoom = body.clients[1]!;
    expect(zoom.rows.map((r) => r.fitmentId)).toEqual([w.firstMinute, w.lastMinute]);
    expect(zoom.rows[0]).toMatchObject({
      site: 'Bengaluru depot',
      activity: 'New installation',
      technician: 'Arjun Tech',
      finalIssue: 'Wiring issue',
      deviceId: 'DEV-1',
      vehicleRegNo: 'KA01AB1234',
      approvedAt: at('2026-09-01', 0).toISOString(),
    });
    expect(zoom.rows[0]!.tkId).toMatch(/^TK-\d{5}$/);
    expect(zoom.rows[0]!.omId).toMatch(/^OM-\d{5}$/);

    const oct = (await api().get('/api/reports/billing').query({ month: '2026-10' }).set(bearer(w.ro))).body as BillingReportResponse;
    expect(oct.totals).toEqual({ billable: 1, nonBillable: 0 });
  });

  it('filters by client, checks roles and the month format', async () => {
    const w = await billingWorld();
    const res = await api().get('/api/reports/billing').query({ month: '2026-09', clientId: w.otherClient.id }).set(bearer(w.sa));
    expect((res.body as BillingReportResponse).clients.map((c) => c.client)).toEqual(['Other Fleet']);
    expect((await api().get('/api/reports/billing').query({ month: '2026-09' }).set(bearer(w.oe))).status).toBe(403);
    expect((await api().get('/api/reports/billing').query({ month: '2026-09' }).set(bearer(w.ot))).status).toBe(403);
    expect((await api().get('/api/reports/billing').query({ month: '2026-13' }).set(bearer(w.om))).status).toBe(400);
    expect((await api().get('/api/reports/billing').set(bearer(w.om))).status).toBe(400);
  });

  it('downloads a flat CSV with the client first', async () => {
    const w = await billingWorld();
    let res = await api().get('/api/reports/billing').query({ month: '2026-09', format: 'csv' }).set(bearer(w.om)).buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(/filename="?billing-2026-09\.csv"?$/);
    const lines = csvLines(res.text);
    expect(lines[0]).toBe(
      'Customer,TK id,OM task ID,Site,Registration number,Chassis number,Device id,Activity,Technician,Final issue,Verified at (IST),Approved at (IST)',
    );
    expect(lines).toHaveLength(4);
    expect(lines[1]).toMatch(/^Other Fleet,TK-\d{5},OM-\d{5},Delhi hub,KA01AB1234,,DEV-1,New installation,Arjun Tech,Wiring issue,2026-09-15 11:00,2026-09-15 12:00$/);
    expect(lines[3]).toMatch(/,2026-09-30 22:50,2026-09-30 23:50$/);

    res = await api().get('/api/reports/billing').query({ month: '2026-09', format: 'csv', clientId: w.client.id }).set(bearer(w.om)).buffer(true);
    expect(res.headers['content-disposition']).toMatch(/billing-2026-09-zoomcar\.csv/);
    expect(csvLines(res.text)).toHaveLength(3);
  });

  it('downloads Excel with a summary sheet and one sheet per client', async () => {
    const w = await billingWorld();
    const res = await api().get('/api/reports/billing').query({ month: '2026-09', format: 'xlsx' }).set(bearer(w.om)).buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/billing-2026-09\.xlsx/);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body as Parameters<typeof workbook.xlsx.load>[0]);
    expect(workbook.worksheets.map((s) => s.name)).toEqual(['Summary', 'Other Fleet', 'Zoomcar']);
    const summary = workbook.getWorksheet('Summary')!;
    expect([1, 2, 3, 4].map((r) => (summary.getRow(r).values as unknown[]).slice(1))).toEqual([
      ['Customer', 'Billable', 'Non-billable'],
      ['Other Fleet', 1, 0],
      ['Zoomcar', 2, 1],
      ['Total', 3, 1],
    ]);
    const zoom = workbook.getWorksheet('Zoomcar')!;
    expect(zoom.rowCount).toBe(3);
    expect(zoom.getRow(1).getCell(1).value).toBe('TK id');
  });

  it('sanitises sheet names: no forbidden characters, at most 31 characters, unique', () => {
    const long = 'A very long customer name that goes past the limit';
    const names = sheetNames(['Acme: North/South [1]', long, long, 'summary', "'Quoted'", 'acme  north south  1']);
    expect(names[0]).toBe('Acme North South 1');
    expect(names[1]).toBe(long.slice(0, 31).trim());
    expect(names[2]).toHaveLength(31);
    expect(names[2]).toMatch(/ \(2\)$/);
    expect(names[3]).toBe('summary (2)');
    expect(names[4]).toBe('Quoted');
    expect(names[5]).toBe('acme north south 1 (2)');
    expect(names.every((n) => n.length <= 31 && !/[:\\/?*[\]]/.test(n))).toBe(true);
  });
});

// --- Analytics ---

/**
 * Hand-built dataset, range 2026-10-05 (Mon) to 2026-10-18 (Sun), two IST weeks.
 * T1 (Zoomcar Bengaluru, OE = oe, created 10-05 08:00): f1 by techA (assigned 09:00, started 10:00, submitted 12:00,
 *   verified, reopened by the OE 15:00, started 10-06 09:00, resubmitted 11:00, verified, approved 20:00);
 *   f2 by techA (started 10-06 10:00, marked faulty 10:30).
 * T2 (Zoomcar Pune, OE = oe2): f3 by techC (assigned 10-12 09:00, started 09:30, submitted 13:30, verified by oe2,
 *   reopened by the OM 15:00 → OE oe2 + OT techC; started again 10-18 23:50 IST).
 * T3 (Other Fleet Delhi, OE = oe, created 10-13 08:00 with techB): f4 (started 10:00, submitted 11:00, verified,
 *   approved 18:00); a submit on 10-04 23:50 IST is outside the range.
 * T5 (Zoomcar Bengaluru, OE = oe2): f5 started by techB 10-14 09:00.
 * T4 (outside the range by fitment date, no events).
 */
async function analyticsWorld() {
  const w = await reportsWorld();
  const t1 = await w.task({ count: 2, createdAt: at('2026-10-05', 8), fitmentAt: at('2026-10-05', 9) });
  const t2 = await w.task({ site: 'pune', oe: w.oe2, createdAt: at('2026-10-12', 8), fitmentAt: at('2026-10-12', 9) });
  const t3 = await w.task({ site: 'delhi', createdAt: at('2026-10-13', 8), fitmentAt: at('2026-10-13', 9) });
  const t5 = await w.task({ oe: w.oe2, createdAt: at('2026-10-14', 8), fitmentAt: at('2026-10-14', 9) });
  await w.task({ createdAt: at('2026-10-19', 8), fitmentAt: at('2026-10-20', 9) });
  const [f1, f2] = t1.fitments as [string, string];
  const f3 = t2.fitments[0]!;
  const f4 = t3.fitments[0]!;
  const f5 = t5.fitments[0]!;
  await w.setFitment(f1, { status: 'OM_APPROVED', technicianId: w.techA.id });
  await w.setFitment(f2, { status: 'MOVED_TO_FT', technicianId: w.techA.id });
  await w.setFitment(f3, { status: 'IN_PROGRESS', technicianId: w.techC.id });
  await w.setFitment(f4, { status: 'OM_APPROVED', technicianId: w.techB.id });
  await w.setFitment(f5, { status: 'IN_PROGRESS', technicianId: w.techB.id });

  await prisma.taskEvent.deleteMany({});
  const taskOf: Record<string, string> = { [f1]: t1.id, [f2]: t1.id, [f3]: t2.id, [f4]: t3.id, [f5]: t5.id };
  const ev = (type: string, fitmentId: string, actor: User, createdAt: Date, data: Record<string, string> = {}) =>
    prisma.taskEvent.create({ data: { taskId: taskOf[fitmentId]!, fitmentId, actorId: actor.id, type, createdAt, data } });
  const reopen = async (fitmentId: string, actor: User, createdAt: Date, users: User[]) => {
    const e = await ev('FITMENT_REOPENED', fitmentId, actor, createdAt);
    for (const u of users) await prisma.reopenAttribution.create({ data: { eventId: e.id, fitmentId, userId: u.id, role: u.role } });
  };

  // T1
  await ev('FITMENT_ASSIGNED', f1, w.om, at('2026-10-05', 9), { technicianId: w.techA.id });
  await ev('FITMENT_STARTED', f1, w.techA, at('2026-10-05', 10));
  await ev('FITMENT_SUBMITTED', f1, w.techA, at('2026-10-05', 12));
  await ev('FITMENT_VERIFIED', f1, w.oe, at('2026-10-05', 14));
  await reopen(f1, w.oe, at('2026-10-05', 15), [w.techA]);
  await ev('FITMENT_STARTED', f1, w.techA, at('2026-10-06', 9));
  await ev('FITMENT_SUBMITTED', f1, w.techA, at('2026-10-06', 11));
  await ev('FITMENT_VERIFIED', f1, w.oe, at('2026-10-06', 12));
  await ev('FITMENT_APPROVED', f1, w.om, at('2026-10-06', 20));
  await ev('FITMENT_STARTED', f2, w.techA, at('2026-10-06', 10));
  await ev('FITMENT_MARKED_FAULTY', f2, w.techA, at('2026-10-06', 10.5));
  // T2
  await ev('FITMENT_ASSIGNED', f3, w.oe2, at('2026-10-12', 9), { technicianId: w.techC.id });
  await ev('FITMENT_STARTED', f3, w.techC, at('2026-10-12', 9.5));
  await ev('FITMENT_SUBMITTED', f3, w.techC, at('2026-10-12', 13.5));
  await ev('FITMENT_VERIFIED', f3, w.oe2, at('2026-10-12', 14));
  await reopen(f3, w.om, at('2026-10-12', 15), [w.oe2, w.techC]);
  await ev('FITMENT_STARTED', f3, w.techC, at('2026-10-18', 23 + 50 / 60)); // last minutes of the range
  // T3: assigned at creation (task-level TASK_CREATED)
  await prisma.taskEvent.create({ data: { taskId: t3.id, actorId: w.om.id, type: 'TASK_CREATED', createdAt: at('2026-10-13', 9), data: { technicianId: w.techB.id } } });
  await ev('FITMENT_SUBMITTED', f4, w.techB, at('2026-10-04', 23 + 50 / 60)); // before the range
  await ev('FITMENT_STARTED', f4, w.techB, at('2026-10-13', 10));
  await ev('FITMENT_SUBMITTED', f4, w.techB, at('2026-10-13', 11));
  await ev('FITMENT_VERIFIED', f4, w.oe, at('2026-10-13', 12));
  await ev('FITMENT_APPROVED', f4, w.om, at('2026-10-13', 18));
  // T5
  await ev('FITMENT_STARTED', f5, w.techB, at('2026-10-14', 9));
  return w;
}

const RANGE = { from: '2026-10-05', to: '2026-10-18' };
const analytics = async (user: User, query: Record<string, string> = {}) => {
  const res = await api().get('/api/reports/analytics').query({ ...RANGE, ...query }).set(bearer(user));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as AnalyticsResponse;
};

describe('GET /api/reports/analytics', () => {
  it('computes every KPI on the hand-built dataset', async () => {
    const w = await analyticsWorld();
    const a = await analytics(w.om);

    expect(a.statusCounts.filter((s) => s.count > 0)).toEqual([
      { status: 'IN_PROGRESS', count: 2 },
      { status: 'OM_APPROVED', count: 2 },
      { status: 'MOVED_TO_FT', count: 1 },
    ]);
    expect(a.statusCounts).toHaveLength(9);
    // Field: [2, 3, 4.5, 26] h; end-to-end: [10, 36] h.
    expect(a.turnaround).toEqual({
      field: { count: 4, medianHours: 3.8, p90Hours: 26 },
      endToEnd: { count: 2, medianHours: 23, p90Hours: 36 },
    });
    expect(a.reopenRate).toEqual({ reopens: 2, submitted: 4, rate: 0.5 });
    expect(a.fitmentsPerTechnicianPerDay).toEqual({ submitted: 4, technicianDays: 6, average: 0.6667 });
    expect(a.faultyRate).toEqual({ movedToFt: 1, started: 7, rate: 0.1429 });
    expect(a.km).toEqual({ total: 0, approx: false });
    expect(a.weekly).toEqual([
      { weekStart: '2026-10-05', submitted: 2, approved: 1, reopens: 1, movedToFt: 1, started: 3, km: 0 },
      { weekStart: '2026-10-12', submitted: 2, approved: 1, reopens: 1, movedToFt: 0, started: 4, km: 0 },
    ]);

    expect(a.technicians.map((t) => t.user.name)).toEqual(['Arjun Tech', 'Bhavna Tech', 'Chetan Tech']);
    const [techA, techB, techC] = a.technicians;
    expect(techA).toMatchObject({
      started: 3,
      submitted: 2,
      workingDays: 2,
      fitmentsPerDay: 1,
      reopens: 1,
      reopenRate: 0.5,
      movedToFt: 1,
      faultyRate: 0.3333,
      fieldTat: { count: 2, medianHours: 14.5, p90Hours: 26 },
    });
    expect(techB).toMatchObject({ started: 2, submitted: 1, workingDays: 2, fitmentsPerDay: 0.5, reopens: 0, reopenRate: 0, fieldTat: { count: 1, medianHours: 2 } });
    expect(techC).toMatchObject({ started: 2, submitted: 1, workingDays: 2, reopens: 1, reopenRate: 1, movedToFt: 0, faultyRate: 0 });

    expect(a.oes.map((o) => [o.user.id, o.verified, o.reopens, o.reopenRate])).toEqual([
      [w.oe.id, 3, 0, 0],
      [w.oe2.id, 1, 1, 1],
    ]);
    expect(a.oes[0]!.endToEndTat).toEqual({ count: 2, medianHours: 23, p90Hours: 36 });
    expect(a.oes[1]!.endToEndTat).toEqual({ count: 0, medianHours: null, p90Hours: null });
  });

  it('IST day boundaries and an empty range', async () => {
    const w = await analyticsWorld();
    const lastDay = await analytics(w.om, { from: '2026-10-18', to: '2026-10-18' });
    expect(lastDay.faultyRate.started).toBe(1);
    expect(lastDay.weekly.map((p) => p.weekStart)).toEqual(['2026-10-12']);
    const before = await analytics(w.om, { from: '2026-10-04', to: '2026-10-04' });
    expect(before.reopenRate).toEqual({ reopens: 0, submitted: 1, rate: 0 });
    const empty = await analytics(w.om, { from: '2026-11-01', to: '2026-11-30' });
    expect(empty).toMatchObject({ technicians: [], oes: [], reopenRate: { rate: null }, faultyRate: { rate: null }, fitmentsPerTechnicianPerDay: { average: null } });
    expect(empty.turnaround.field).toEqual({ count: 0, medianHours: null, p90Hours: null });
    expect(empty.weekly.map((p) => p.weekStart)).toEqual(['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30']);
  });

  it('filters by client, OE and region', async () => {
    const w = await analyticsWorld();
    const other = await analytics(w.om, { clientId: w.otherClient.id });
    expect(other.technicians.map((t) => [t.user.name, t.submitted])).toEqual([['Bhavna Tech', 1]]);
    expect(other.statusCounts.find((s) => s.status === 'OM_APPROVED')!.count).toBe(1);

    const byOe = await analytics(w.sa, { oeId: w.oe2.id });
    expect(byOe.technicians.map((t) => [t.user.name, t.started])).toEqual([
      ['Bhavna Tech', 1],
      ['Chetan Tech', 2],
    ]);
    expect(byOe.oes.map((o) => o.user.name)).toEqual(['Zed OE']);

    const pune = await analytics(w.ro, { regionId: w.pune.regionId });
    expect(pune.technicians.map((t) => t.user.name)).toEqual(['Chetan Tech']);
    expect(pune.reopenRate).toEqual({ reopens: 1, submitted: 1, rate: 1 });
  });

  it('scopes an OE to their own tasks and their own technicians', async () => {
    const w = await analyticsWorld();
    const mine = await analytics(w.oe);
    // T1 and T3 (own tasks) plus f5 (techB is theirs, on oe2's task); not T2.
    expect(mine.technicians.map((t) => [t.user.name, t.started])).toEqual([
      ['Arjun Tech', 3],
      ['Bhavna Tech', 2],
    ]);
    expect(mine.reopenRate).toEqual({ reopens: 1, submitted: 3, rate: 0.3333 });
    expect(mine.oes.map((o) => [o.user.id, o.verified])).toEqual([[w.oe.id, 3]]);
    expect(mine.statusCounts.find((s) => s.status === 'IN_PROGRESS')!.count).toBe(1);

    expect((await analytics(w.oe, { oeId: w.oe.id })).technicians).toHaveLength(2);
    expect((await api().get('/api/reports/analytics').query({ ...RANGE, oeId: w.oe2.id }).set(bearer(w.oe))).status).toBe(403);

    const theirs = await analytics(w.oe2);
    expect(theirs.oes.map((o) => o.user.id)).toEqual([w.oe2.id]);
    expect(theirs.technicians.map((t) => t.user.name)).toEqual(['Bhavna Tech', 'Chetan Tech']);
  });

  it('validates the range and roles', async () => {
    const w = await analyticsWorld();
    const status = async (query: Record<string, string>, user: User = w.om) =>
      (await api().get('/api/reports/analytics').query(query).set(bearer(user))).status;
    expect(await status({ from: '2026-10-10', to: '2026-10-09' })).toBe(400);
    expect(await status({ from: '2025-10-01', to: '2026-10-02' })).toBe(400); // 367 days
    expect(await status({ from: '2025-10-01', to: '2026-10-01' })).toBe(200); // 366 days
    expect(await status({ from: '2026-02-30', to: '2026-03-01' })).toBe(400);
    expect(await status({ from: '2026-10-01' })).toBe(400);
    expect(await status(RANGE, w.ot)).toBe(403);
    expect(await status(RANGE, w.ro)).toBe(200);
  });

  it('downloads the technician and OE tables as CSV', async () => {
    const w = await analyticsWorld();
    let res = await api().get('/api/reports/analytics').query({ ...RANGE, format: 'csv', table: 'technicians' }).set(bearer(w.om)).buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/analytics-technicians-2026-10-05-to-2026-10-18\.csv/);
    let lines = csvLines(res.text);
    expect(lines[0]).toBe(
      'Technician,Started,Submitted,Working days,Fitments per day,Reopens,Reopen rate,Moved to FT,Faulty rate,Km,Km approximate,Field TAT count,Field TAT median (h),Field TAT P90 (h)',
    );
    expect(lines[1]).toBe('Arjun Tech,3,2,2,1,1,50%,1,33.3%,0,No,2,14.5,26');
    expect(lines).toHaveLength(4);

    res = await api().get('/api/reports/analytics').query({ ...RANGE, format: 'csv', table: 'oes' }).set(bearer(w.om)).buffer(true);
    expect(res.headers['content-disposition']).toMatch(/analytics-oes-2026-10-05-to-2026-10-18\.csv/);
    lines = csvLines(res.text);
    expect(lines[0]).toBe('Operation executive,Verified,Reopens,Reopen rate,End-to-end TAT count,End-to-end TAT median (h),End-to-end TAT P90 (h)');
    expect(lines[2]).toBe('Zed OE,1,1,100%,0,,');
  });

  it('km: a cached routed day distance when its signature matches, else straight lines (approx)', async () => {
    const w = await reportsWorld();
    const day1 = '2026-10-07';
    const day2 = '2026-10-08';
    const points = { blr: { lat: 12.97, lng: 77.59 }, delhi: { lat: 28.5, lng: 77.2 } };
    const fitments: { id: string; siteId: string; lat: number; lng: number }[] = [];
    for (const [day, hour, site] of [
      [day1, 9, 'blr'],
      [day1, 12, 'delhi'],
      [day2, 9, 'blr'],
      [day2, 12, 'delhi'],
    ] as const) {
      const t = await w.task({ site, createdAt: at(day, 8), fitmentAt: at(day, 9) });
      const id = t.fitments[0]!;
      await w.setFitment(id, { status: 'IN_PROGRESS', technicianId: w.techA.id, startedAt: at(day, hour), startLat: points[site].lat, startLng: points[site].lng });
      await prisma.taskEvent.create({ data: { taskId: t.id, fitmentId: id, actorId: w.techA.id, type: 'FITMENT_STARTED', createdAt: at(day, hour) } });
      fitments.push({ id, siteId: w.sites[site].id, ...points[site] });
    }
    // Same signature as the F12 history module (ordered start points with site).
    const signature = (rows: typeof fitments) =>
      createHash('sha256')
        .update(rows.map((f) => `${f.id}:${f.lat.toFixed(6)},${f.lng.toFixed(6)}:${f.siteId}`).join('|'))
        .digest('hex');
    await prisma.dayDistance.create({
      data: { userId: w.techA.id, date: new Date(`${day1}T00:00:00.000Z`), signature: signature(fitments.slice(0, 2)), distanceM: 1_500_000, approx: false, legs: [] },
    });
    // A stale cache (wrong signature) on day 2 is ignored.
    await prisma.dayDistance.create({
      data: { userId: w.techA.id, date: new Date(`${day2}T00:00:00.000Z`), signature: 'stale', distanceM: 9_999_999, approx: false, legs: [] },
    });
    const straight = straightLineRoute([points.blr, points.delhi]).legs[0]!.distanceM;

    const day1Only = await analytics(w.om, { from: day1, to: day1 });
    expect(day1Only.km).toEqual({ total: 1500, approx: false });
    expect(day1Only.technicians[0]).toMatchObject({ km: 1500, kmApprox: false, workingDays: 1 });

    const both = await analytics(w.om, { from: day1, to: day2 });
    const expected = Math.round((1_500_000 + straight) / 100) / 10;
    expect(both.km).toEqual({ total: expected, approx: true });
    expect(both.technicians[0]).toMatchObject({ km: expected, kmApprox: true, workingDays: 2 });
    expect(both.weekly).toEqual([expect.objectContaining({ weekStart: '2026-10-05', km: expected, started: 4 })]);
  });
});
