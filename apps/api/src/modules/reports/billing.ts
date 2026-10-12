import ExcelJS from 'exceljs';
import {
  formatIstDateTime,
  formatOmId,
  formatTkId,
  istMonthRange,
  toCsv,
  type BillingClientGroup,
  type BillingQuery,
  type BillingReportResponse,
  type BillingRow,
} from '@champ/shared';
import type { Prisma } from '../../generated/prisma/client';
import { notFound } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { safeText, type ExportColumn, type ExportFile } from '../tasks/export';

const billingSelect = {
  id: true,
  tkNo: true,
  taskId: true,
  vehicleRegNo: true,
  chassisNo: true,
  deviceId: true,
  billable: true,
  verifiedAt: true,
  approvedAt: true,
  technician: { select: { name: true } },
  finalIssue: { select: { name: true } },
  task: { select: { omNo: true, clientId: true, client: { select: { name: true } }, site: { select: { name: true } }, activity: { select: { name: true } } } },
} satisfies Prisma.FitmentSelect;

/**
 * The billing report of an IST month (D-264): fitments currently OM_APPROVED whose final approval is in the
 * month, of tasks that aren't deleted, grouped by client (name order), rows by approval time. Billable ones are
 * listed; non-billable approved ones are only counted.
 */
export async function getBillingReport(query: BillingQuery): Promise<BillingReportResponse> {
  const fitments = await prisma.fitment.findMany({
    where: {
      status: 'OM_APPROVED',
      approvedAt: istMonthRange(query.month),
      task: { deletedAt: null, ...(query.clientId && { clientId: query.clientId }) },
    },
    select: billingSelect,
    orderBy: [{ approvedAt: 'asc' }, { tkNo: 'asc' }],
  });

  const groups = new Map<string, BillingClientGroup>();
  for (const f of fitments) {
    let group = groups.get(f.task.clientId);
    if (!group) {
      group = { clientId: f.task.clientId, client: f.task.client.name, billableCount: 0, nonBillableCount: 0, rows: [] };
      groups.set(f.task.clientId, group);
    }
    if (f.billable !== true) {
      group.nonBillableCount += 1;
      continue;
    }
    group.billableCount += 1;
    group.rows.push({
      fitmentId: f.id,
      tkId: formatTkId(f.tkNo),
      taskId: f.taskId,
      omId: formatOmId(f.task.omNo),
      site: f.task.site.name,
      vehicleRegNo: f.vehicleRegNo,
      chassisNo: f.chassisNo,
      deviceId: f.deviceId,
      activity: f.task.activity.name,
      technician: f.technician?.name ?? null,
      finalIssue: f.finalIssue?.name ?? null,
      verifiedAt: f.verifiedAt?.toISOString() ?? null,
      approvedAt: f.approvedAt!.toISOString(),
    });
  }
  const clients = [...groups.values()].sort((a, b) => a.client.localeCompare(b.client) || a.clientId.localeCompare(b.clientId));
  return {
    month: query.month,
    clients,
    totals: {
      billable: clients.reduce((sum, c) => sum + c.billableCount, 0),
      nonBillable: clients.reduce((sum, c) => sum + c.nonBillableCount, 0),
    },
  };
}

type Row = BillingRow & { client: string };

const istOrBlank = (iso: string | null) => (iso ? formatIstDateTime(iso) : '');

/** Billing columns (times in IST); the CSV puts the client first, the per-client sheets leave it out. */
export const BILLING_COLUMNS: ExportColumn<Row>[] = [
  { header: 'Customer', width: 24, value: (r) => r.client },
  { header: 'TK id', width: 12, value: (r) => r.tkId },
  { header: 'OM task ID', width: 12, value: (r) => r.omId },
  { header: 'Site', width: 20, value: (r) => r.site },
  { header: 'Registration number', width: 16, value: (r) => r.vehicleRegNo ?? '' },
  { header: 'Chassis number', width: 18, value: (r) => r.chassisNo ?? '' },
  { header: 'Device id', width: 14, value: (r) => r.deviceId ?? '' },
  { header: 'Activity', width: 18, value: (r) => r.activity },
  { header: 'Technician', width: 18, value: (r) => r.technician ?? '' },
  { header: 'Final issue', width: 20, value: (r) => r.finalIssue ?? '' },
  { header: 'Verified at (IST)', width: 18, value: (r) => istOrBlank(r.verifiedAt) },
  { header: 'Approved at (IST)', width: 18, value: (r) => istOrBlank(r.approvedAt) },
];

/** Text safe as a file name part: lowercase letters, digits and dashes. */
const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'client';

/**
 * Excel sheet names (D-268): without `: \ / ? * [ ]`, not starting or ending with an apostrophe, at most 31
 * characters, unique ignoring case (a ` (2)` suffix), never "Summary".
 */
export function sheetNames(names: readonly string[]): string[] {
  const used = new Set(['summary']);
  return names.map((name) => {
    const base = name.replace(/[:\\/?*[\]]/g, ' ').replace(/^'+|'+$/g, '').replace(/\s+/g, ' ').trim().slice(0, 31).trim() || 'Client';
    let candidate = base;
    for (let n = 2; used.has(candidate.toLowerCase()); n += 1) {
      const suffix = ` (${n})`;
      candidate = `${base.slice(0, 31 - suffix.length).trimEnd()}${suffix}`;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

/** `format=csv|xlsx`: one flat CSV, or a Summary sheet plus one sheet per client (D-268). */
export async function billingFile(query: BillingQuery): Promise<ExportFile> {
  const report = await getBillingReport(query);
  let base = `billing-${query.month}`;
  if (query.clientId) {
    const client = await prisma.client.findUnique({ where: { id: query.clientId }, select: { name: true } });
    if (!client) throw notFound('Client not found');
    base += `-${slug(client.name)}`;
  }
  const rowsOf = (c: BillingClientGroup): Row[] => c.rows.map((r) => ({ ...r, client: c.client }));

  if (query.format === 'xlsx') {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Champ';
    const summary = workbook.addWorksheet('Summary', { views: [{ state: 'frozen', ySplit: 1 }] });
    summary.columns = [
      { header: 'Customer', width: 28 },
      { header: 'Billable', width: 10 },
      { header: 'Non-billable', width: 12 },
    ];
    summary.getRow(1).font = { bold: true };
    summary.addRows(report.clients.map((c) => [safeText(c.client), c.billableCount, c.nonBillableCount]));
    const total = summary.addRow(['Total', report.totals.billable, report.totals.nonBillable]);
    total.font = { bold: true };

    const columns = BILLING_COLUMNS.slice(1);
    const names = sheetNames(report.clients.map((c) => c.client));
    report.clients.forEach((c, i) => {
      const sheet = workbook.addWorksheet(names[i]!, { views: [{ state: 'frozen', ySplit: 1 }] });
      sheet.columns = columns.map((col) => ({ header: col.header, width: col.width }));
      sheet.getRow(1).font = { bold: true };
      sheet.addRows(rowsOf(c).map((r) => columns.map((col) => safeText(col.value(r)))));
    });
    return {
      filename: `${base}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: Buffer.from(await workbook.xlsx.writeBuffer()),
    };
  }
  const rows = report.clients.flatMap(rowsOf).map((r) => BILLING_COLUMNS.map((c) => safeText(c.value(r))));
  const header = BILLING_COLUMNS.map((c) => c.header);
  return { filename: `${base}.csv`, contentType: 'text/csv; charset=utf-8', body: Buffer.from(`\uFEFF${toCsv(header, rows)}`) };
}
