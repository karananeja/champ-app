import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';
import { BULK_TASK_COLUMNS, toCsv, type BulkPreviewResponse, type TaskDto } from '@champ/shared';
import { prisma, type User } from '../src/lib/prisma';
import { bearer, createTaskWorld, createUser, testApi } from './helpers';

const api = () => testApi();
type World = Awaited<ReturnType<typeof createTaskWorld>>;

/** A bulk CSV row with sensible defaults (the org's OE, Vehicle, Tata Ace, 2 vehicles). */
const bulkRow = (w: World, overrides: Partial<Record<(typeof BULK_TASK_COLUMNS)[number], string>> = {}) => ({
  customer: 'zoom',
  site: 'bengaluru DEPOT',
  oe_email: w.oe.email,
  technician_email: '',
  technician_type: '',
  asset_type: 'vehicle',
  activity: 'New Installation',
  device_type: '',
  vehicle_make: 'tata',
  vehicle_model: 'ACE',
  installation_type: 'gps',
  requested_fitment_at: '2026-10-20 10:00',
  fitment_at: '2026-10-21 10:30',
  shift_type: 'Day',
  vehicle_count: '2',
  issue_reported: 'device not reporting',
  poc_name: '',
  poc_phone: '',
  poc_email: '',
  gps_address: '',
  comments: '',
  ...overrides,
});

const csvOf = (rows: Record<string, string>[], columns: readonly string[] = BULK_TASK_COLUMNS) =>
  toCsv(
    columns,
    rows.map((r) => columns.map((c) => r[c] ?? '')),
  );

const preview = (actor: User, csv: string, name = 'tasks.csv') =>
  api().post('/api/tasks/bulk/preview').set(bearer(actor)).attach('file', Buffer.from(csv), name);

async function createTask(w: World, actor: User, overrides: Record<string, unknown> = {}): Promise<TaskDto> {
  const res = await api().post('/api/tasks').set(bearer(actor)).send(w.taskBody(overrides));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as TaskDto;
}

describe('bulk upload — preview', () => {
  it('validates each row and reports a message per bad cell, writing nothing', async () => {
    const w = await createTaskWorld();
    const csv = csvOf([
      bulkRow(w),
      bulkRow(w, { customer: 'Nobody Ltd', fitment_at: '21/10/2026', vehicle_count: '0' }),
      bulkRow(w, { asset_type: 'Battery', activity: 'new installation' }),
      bulkRow(w, { technician_email: w.techA.email, technician_type: 'third party', oe_email: '' }),
      bulkRow(w, { site: 'Delhi hub', shift_type: 'Afternoon', poc_phone: 'abc', vehicle_make: '' }),
    ]);
    const res = await preview(w.om, csv);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.body as BulkPreviewResponse;
    expect(body).toMatchObject({ validCount: 1, invalidCount: 4 });
    expect(body.rows.map((r) => [r.rowNumber, r.valid])).toEqual([
      [2, true],
      [3, false],
      [4, false],
      [5, false],
      [6, false],
    ]);
    expect(body.rows[0]!.data.customer).toBe('zoom');
    expect(body.rows[1]!.errors).toEqual([
      { column: 'customer', message: 'No active customer "Nobody Ltd"' },
      { column: 'fitment_at', message: 'Use YYYY-MM-DD HH:mm (IST), e.g. 2026-10-15 10:30' },
      { column: 'vehicle_count', message: 'Enter a whole number from 1 to 500' },
    ]);
    expect(body.rows[2]!.errors).toEqual([{ column: 'vehicle_make', message: 'Only for Vehicle assets; leave it blank' }]);
    expect(body.rows[3]!.errors).toEqual([
      { column: 'oe_email', message: 'Required' },
      { column: 'technician_email', message: "Arjun Tech isn't a Third party technician" },
    ]);
    expect(body.rows[4]!.errors).toEqual([
      { column: 'site', message: 'No active site "Delhi hub" for Zoomcar' },
      { column: 'vehicle_make', message: 'Required' },
      { column: 'shift_type', message: 'No active shift type "Afternoon"' },
    ]);
    expect(await prisma.task.count()).toBe(0);
  });

  it('format errors found by the shared schema are mapped to their columns', async () => {
    const w = await createTaskWorld();
    const res = await preview(w.om, csvOf([bulkRow(w, { poc_phone: 'abc', poc_email: 'nope' })]));
    expect(res.body.rows[0].errors).toEqual([
      { column: 'poc_phone', message: 'Enter a valid phone number' },
      { column: 'poc_email', message: 'Enter a valid email address' },
    ]);
  });

  it('accepts headers in any case/order, skips blank lines and needs only the required columns', async () => {
    const w = await createTaskWorld();
    const row = bulkRow(w);
    const columns = ['Customer', 'SITE', 'oe_email', 'Asset Type', 'activity', 'vehicle_make', 'vehicle_model', 'installation_type', 'requested_fitment_at', 'fitment_at', 'shift_type', 'vehicle_count', 'issue_reported'];
    const csv = `\uFEFF${columns.join(',')}\r\n\r\n${columns.map((c) => (row as Record<string, string>)[c.toLowerCase().replace(' ', '_')]).join(',')}\r\n,,,,\r\n`;
    const res = await preview(w.om, csv);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ validCount: 1, invalidCount: 0 });
  });

  it('rejects files without the required columns, empty files, non-CSV files and more than 1,000 rows', async () => {
    const w = await createTaskWorld();
    const missing = await preview(w.om, 'customer,site\r\nZOOM,Bengaluru depot\r\n');
    expect(missing.status).toBe(400);
    expect(missing.body.error.message).toMatch(/^Missing column\(s\): asset_type, activity/);
    expect((await preview(w.om, `${BULK_TASK_COLUMNS.join(',')}\r\n`)).body.error.message).toBe('The file has no task rows');
    expect((await preview(w.om, csvOf([bulkRow(w)]), 'tasks.xlsx')).body.error.message).toBe('Upload a .csv file');
    const tooMany = csvOf(Array.from({ length: 1001 }, () => bulkRow(w)));
    expect((await preview(w.om, tooMany)).body.error.message).toBe('At most 1000 rows per file (this one has 1001)');
    const noFile = await api().post('/api/tasks/bulk/preview').set(bearer(w.om));
    expect(noFile.body.error.message).toBe('Choose a CSV file to upload');
    const big = await preview(w.om, 'x'.repeat(2 * 1024 * 1024 + 1));
    expect(big.body.error.message).toBe('The file must be 2 MB or smaller');
  });
});

describe('bulk upload — import', () => {
  it('creates only the valid rows, each as its own task, and reports the rest', async () => {
    const w = await createTaskWorld();
    const rows = [
      bulkRow(w, { vehicle_count: '3', technician_email: w.techA.email }),
      bulkRow(w, { activity: 'Teleport' }),
      bulkRow(w, { asset_type: 'Battery', vehicle_make: '', vehicle_model: '', poc_name: 'Anil', poc_phone: '+91 90000 99999', comments: 'From bulk' }),
    ];
    const res = await api()
      .post('/api/tasks/bulk/import')
      .set(bearer(w.om))
      .send({ rows: rows.map((data, i) => ({ rowNumber: i + 2, data })) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.created).toEqual([
      { rowNumber: 2, id: expect.any(String), omId: 'OM-00001' },
      { rowNumber: 4, id: expect.any(String), omId: 'OM-00002' },
    ]);
    expect(res.body.failed).toEqual([{ rowNumber: 3, errors: [{ column: 'activity', message: 'No active activity "Teleport" for Vehicle' }] }]);

    const first = (await api().get(`/api/tasks/${res.body.created[0].id}`).set(bearer(w.om))).body as TaskDto;
    expect(first).toMatchObject({
      status: 'ASSIGNED',
      technicianType: 'PAYROLL',
      pocName: 'Priya Rao', // blank → client contact
      pocPhone: '+91 98765 43210',
      deviceType: { code: 'LAF5' }, // blank → LAF5
      makeModel: { make: 'Tata' },
      fitmentAt: '2026-10-21T05:00:00.000Z', // 10:30 IST
      counts: { total: 3, assigned: 3, open: 0 },
    });
    const second = (await api().get(`/api/tasks/${res.body.created[1].id}`).set(bearer(w.om))).body as TaskDto;
    expect(second).toMatchObject({ pocName: 'Anil', comments: 'From bulk', makeModel: null, assetType: { code: 'BATTERY' } });
    expect(await prisma.taskEvent.count({ where: { type: 'TASK_CREATED' } })).toBe(2);
  });

  it('OE rows: a blank oe_email means yourself; another OE is refused', async () => {
    const w = await createTaskWorld();
    const otherOe = await createUser({ role: 'OE', managerId: w.om.id });
    const rows = [bulkRow(w, { oe_email: '' }), bulkRow(w, { oe_email: w.oe.email.toUpperCase() }), bulkRow(w, { oe_email: otherOe.email })];
    const res = await api()
      .post('/api/tasks/bulk/import')
      .set(bearer(w.oe))
      .send({ rows: rows.map((data, i) => ({ rowNumber: i + 2, data })) });
    expect(res.body.created.map((c: { rowNumber: number }) => c.rowNumber)).toEqual([2, 3]);
    expect(res.body.failed).toEqual([
      { rowNumber: 4, errors: [{ column: 'oe_email', message: 'You can only create tasks for yourself; leave it blank' }] },
    ]);
    const tasks = await prisma.task.findMany();
    expect(tasks.every((t) => t.oeId === w.oe.id && t.createdById === w.oe.id)).toBe(true);
    // SA/OM must name the OE.
    const om = await api()
      .post('/api/tasks/bulk/import')
      .set(bearer(w.om))
      .send({ rows: [{ rowNumber: 2, data: bulkRow(w, { oe_email: '' }) }] });
    expect(om.body.failed[0].errors).toEqual([{ column: 'oe_email', message: 'Required' }]);
  });

  it('validates the import body', async () => {
    const w = await createTaskWorld();
    expect((await api().post('/api/tasks/bulk/import').set(bearer(w.om)).send({ rows: [] })).status).toBe(400);
    expect((await api().post('/api/tasks/bulk/import').set(bearer(w.om)).send({})).status).toBe(400);
  });
});

describe('bulk upload — sample', () => {
  it('has every column and two example rows built from active values, which preview as valid', async () => {
    const w = await createTaskWorld();
    const res = await api().get('/api/tasks/bulk/sample').set(bearer(w.om));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    expect(res.headers['content-disposition']).toBe('attachment; filename=champ-bulk-tasks-sample.csv');
    const parsed = Papa.parse<Record<string, string>>(res.text, { header: true, skipEmptyLines: true });
    expect(parsed.meta.fields).toEqual([...BULK_TASK_COLUMNS]);
    expect(parsed.data).toHaveLength(2);
    expect(parsed.data[0]).toMatchObject({ customer: 'Other Fleet', site: 'Delhi hub', asset_type: 'Vehicle', oe_email: w.oe.email });
    expect(parsed.data[1]).toMatchObject({ asset_type: 'Battery', vehicle_make: '' });

    const check = await preview(w.om, res.text);
    expect(check.body.rows.map((r: { errors: unknown[] }) => r.errors)).toEqual([[], []]);
  });
});

describe('export', () => {
  it('exports the filtered list as CSV with readable columns and IST times', async () => {
    const w = await createTaskWorld();
    await createTask(w, w.om, { technicianId: w.techA.id, comments: '=HYPERLINK("x")' });
    await createTask(w, w.om);
    await createTask(w, w.om, { clientId: w.otherClient.id, siteId: w.otherClient.sites[0]!.id });

    const res = await api().get('/api/tasks/export').query({ clientId: w.client.id }).set(bearer(w.ro));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename=champ-tasks-\d{8}-\d{4}\.csv$/);
    const parsed = Papa.parse<Record<string, string>>(res.text.replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: true });
    expect(parsed.data).toHaveLength(2);
    expect(parsed.data[0]).toMatchObject({
      'OM task ID': 'OM-00001',
      'OE task ID': 'OE-00001',
      Status: 'Assigned',
      Customer: 'Zoomcar',
      Site: 'Bengaluru depot',
      City: 'Bengaluru',
      'POC phone': '+91 98765 43210',
      Technicians: 'Arjun Tech',
      'Technician type': 'Payroll',
      'Vehicle make/model': 'Tata Ace',
      'Fitment (IST)': '2026-10-21 10:30',
      Vehicles: '2',
      'Assigned fitments': '2',
      Comments: `'=HYPERLINK("x")`,
    });
  });

  it('exports xlsx with one row per task', async () => {
    const w = await createTaskWorld();
    for (let i = 0; i < 3; i += 1) await createTask(w, w.om);
    const res = await api()
      .get('/api/tasks/export')
      .query({ format: 'xlsx', view: 'all' })
      .set(bearer(w.om))
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => done(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/filename=champ-tasks-\d{8}-\d{4}\.xlsx$/);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.getWorksheet('Tasks')!;
    expect(sheet.rowCount).toBe(4);
    expect(sheet.getRow(1).getCell(1).value).toBe('OM task ID');
    expect(sheet.getRow(2).getCell(1).value).toBe('OM-00001');
  });

  it('applies the same filters as the list (search, assigned view)', async () => {
    const w = await createTaskWorld();
    await createTask(w, w.om);
    const otherOe = await createUser({ role: 'OE', managerId: w.om.id });
    await createTask(w, w.om, { oeId: otherOe.id });
    const rows = async (actor: User, query: Record<string, string>) => {
      const res = await api().get('/api/tasks/export').query(query).set(bearer(actor));
      return Papa.parse(res.text.replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: true }).data.length;
    };
    expect(await rows(w.om, { q: 'OM-2' })).toBe(1);
    expect(await rows(w.oe, { view: 'assigned' })).toBe(1);
    expect(await rows(w.om, {})).toBe(2);
    expect((await api().get('/api/tasks/export').query({ format: 'pdf' }).set(bearer(w.om))).status).toBe(400);
  });
});
