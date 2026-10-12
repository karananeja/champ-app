import ExcelJS from 'exceljs';
import {
  FITMENT_STATUS_LABELS,
  TASK_STATUS_LABELS,
  billableLabel,
  formatTkId,
  TECHNICIAN_TYPE_LABELS,
  formatIstDateTime,
  formatOeId,
  formatOmId,
  istFileStamp,
  toCsv,
  type ExportFormat,
  type ExportTasksQuery,
} from '@champ/shared';
import type { Prisma } from '../../generated/prisma/client';
import { prisma, type User } from '../../lib/prisma';
import { countFitments, verificationCounts } from './dto';
import { taskOrderBy, taskWhere } from './filters';

/** Most rows in one export. */
export const EXPORT_MAX_ROWS = 10_000;

const exportInclude = {
  taskType: { select: { name: true } },
  client: { select: { name: true, code: true } },
  site: { select: { name: true } },
  location: { select: { city: true } },
  oe: { select: { name: true } },
  assetType: { select: { name: true } },
  activity: { select: { name: true } },
  deviceType: { select: { name: true } },
  makeModel: { select: { make: true, model: true } },
  installationType: { select: { name: true } },
  shiftType: { select: { name: true } },
  issueReported: { select: { name: true } },
  createdBy: { select: { name: true } },
  fitments: {
    select: { status: true, technicianId: true, verifiedAt: true, billable: true, technician: { select: { name: true } } },
    orderBy: { seq: 'asc' },
  },
} satisfies Prisma.TaskInclude;
type ExportRow = Prisma.TaskGetPayload<{ include: typeof exportInclude }>;

/** Readable columns, one row per task (times in IST). */
const COLUMNS: { header: string; width: number; value: (t: ExportRow) => string | number }[] = [
  { header: 'OM task ID', width: 12, value: (t) => formatOmId(t.omNo) },
  { header: 'OE task ID', width: 12, value: (t) => formatOeId(t.oeNo) },
  { header: 'Task type', width: 9, value: (t) => t.taskType.name },
  { header: 'Status', width: 12, value: (t) => TASK_STATUS_LABELS[t.status] },
  { header: 'Customer', width: 24, value: (t) => t.client.name },
  { header: 'Customer code', width: 12, value: (t) => t.client.code ?? '' },
  { header: 'Site', width: 20, value: (t) => t.site.name },
  { header: 'City', width: 14, value: (t) => t.location.city },
  { header: 'POC name', width: 18, value: (t) => t.pocName },
  { header: 'POC phone', width: 16, value: (t) => t.pocPhone },
  { header: 'POC email', width: 22, value: (t) => t.pocEmail ?? '' },
  { header: 'Operation executive', width: 20, value: (t) => t.oe.name },
  { header: 'Technician type', width: 14, value: (t) => (t.technicianType ? TECHNICIAN_TYPE_LABELS[t.technicianType] : '') },
  {
    header: 'Technicians',
    width: 24,
    value: (t) => [...new Set(t.fitments.flatMap((f) => (f.technician ? [f.technician.name] : [])))].join('; '),
  },
  { header: 'Asset type', width: 10, value: (t) => t.assetType.name },
  { header: 'Activity', width: 18, value: (t) => t.activity.name },
  { header: 'Device type', width: 10, value: (t) => t.deviceType.name },
  { header: 'Vehicle make/model', width: 18, value: (t) => (t.makeModel ? `${t.makeModel.make} ${t.makeModel.model}` : '') },
  { header: 'Installation type', width: 12, value: (t) => t.installationType.name },
  { header: 'Requested fitment (IST)', width: 18, value: (t) => formatIstDateTime(t.requestedAt) },
  { header: 'Fitment (IST)', width: 18, value: (t) => formatIstDateTime(t.fitmentAt) },
  { header: 'Shift', width: 12, value: (t) => t.shiftType.name },
  { header: 'Vehicles', width: 9, value: (t) => t.fitments.length },
  { header: 'Assigned fitments', width: 9, value: (t) => countFitments(t.fitments).assigned },
  { header: 'Open fitments', width: 9, value: (t) => countFitments(t.fitments).open },
  { header: 'Issue reported', width: 20, value: (t) => t.issueReported.name },
  { header: 'GPS address', width: 24, value: (t) => t.gpsAddress ?? '' },
  { header: 'Comments', width: 24, value: (t) => t.comments ?? '' },
  { header: 'Created by', width: 18, value: (t) => t.createdBy.name },
  { header: 'Created at (IST)', width: 18, value: (t) => formatIstDateTime(t.createdAt) },
  { header: 'Completed at (IST)', width: 18, value: (t) => (t.completedAt ? formatIstDateTime(t.completedAt) : '') },
  // F06: verified fitments and, of those, billable (the fitment-level export has the details).
  { header: 'Verified fitments', width: 9, value: (t) => verificationCounts(t.fitments).verifiedCount },
  { header: 'Billable fitments', width: 9, value: (t) => verificationCounts(t.fitments).billableCount },
];

/**
 * Neutralises spreadsheet formulas in text cells (CSV injection): a cell starting with =, @, or +/- followed
 * by something other than a digit gets a leading apostrophe. Phone numbers like "+91 …" stay as they are.
 */
export const safeText = (value: string | number) =>
  typeof value === 'string' && /^(?:[=@\t\r]|[+-][^\d\s])/.test(value) ? `'${value}` : value;

export interface ExportFile {
  filename: string;
  contentType: string;
  body: Buffer;
}

/** One export column: its header, Excel width and cell value. */
export type ExportColumn<R> = { header: string; width: number; value: (row: R) => string | number };
type Column<R> = ExportColumn<R>;

// --- Fitment level (F06): one row per fitment with the verification, ready for the billing report (F15) ---

const fitmentExportInclude = {
  task: { select: { omNo: true, oeNo: true, client: { select: { name: true } }, site: { select: { name: true } } } },
  technician: { select: { name: true } },
  issueObserved: { select: { name: true } },
  actionTaken: { select: { name: true } },
  finalIssue: { select: { name: true } },
  accessories: { select: { accessory: { select: { name: true } } } },
} satisfies Prisma.FitmentInclude;
type FitmentExportRow = Prisma.FitmentGetPayload<{ include: typeof fitmentExportInclude }>;

const istOrBlank = (d: Date | null) => (d ? formatIstDateTime(d) : '');

export const FITMENT_COLUMNS: Column<FitmentExportRow>[] = [
  { header: 'TK id', width: 12, value: (f) => formatTkId(f.tkNo) },
  { header: 'OM task ID', width: 12, value: (f) => formatOmId(f.task.omNo) },
  { header: 'OE task ID', width: 12, value: (f) => formatOeId(f.task.oeNo) },
  { header: 'Customer', width: 24, value: (f) => f.task.client.name },
  { header: 'Site', width: 20, value: (f) => f.task.site.name },
  { header: 'Technician', width: 18, value: (f) => f.technician?.name ?? '' },
  { header: 'Status', width: 14, value: (f) => FITMENT_STATUS_LABELS[f.status] },
  { header: 'Registration number', width: 16, value: (f) => f.vehicleRegNo ?? '' },
  { header: 'Chassis number', width: 18, value: (f) => f.chassisNo ?? '' },
  { header: 'Asset number', width: 14, value: (f) => f.assetNumber ?? '' },
  { header: 'Old device id', width: 14, value: (f) => f.oldDeviceId ?? '' },
  { header: 'Issue observed', width: 20, value: (f) => f.issueObserved?.name ?? '' },
  { header: 'Action taken', width: 20, value: (f) => f.actionTaken?.name ?? '' },
  {
    header: 'Accessories',
    width: 24,
    value: (f) => f.accessories.map((a) => a.accessory.name).sort((a, b) => a.localeCompare(b)).join('; '),
  },
  { header: 'Final issue', width: 20, value: (f) => f.finalIssue?.name ?? '' },
  { header: 'Billable', width: 9, value: (f) => (f.verifiedAt ? billableLabel(f.billable) : '') },
  { header: 'Verified at (IST)', width: 18, value: (f) => istOrBlank(f.verifiedAt) },
  { header: 'Approved at (IST)', width: 18, value: (f) => istOrBlank(f.approvedAt) },
];

/** The task order of the list, applied to fitments (through their task), then by position in the task. */
const fitmentOrderBy = (query: ExportTasksQuery): Prisma.FitmentOrderByWithRelationInput[] => [
  ...taskOrderBy(query).map((order) => ({ task: order })),
  { seq: 'asc' },
];

/**
 * `GET /tasks/export`: the list filters without paging (capped at 10,000 rows), as CSV or Excel. `level=task`
 * (default) gives one row per task; `level=fitment` one row per fitment of those tasks (F06; with a technician
 * filter, only that technician's fitments).
 */
export async function exportTasks(actor: User, query: ExportTasksQuery): Promise<ExportFile> {
  const stamp = istFileStamp();
  if (query.level === 'fitment') {
    const fitments = await prisma.fitment.findMany({
      where: { task: taskWhere(actor, query), ...(query.technicianId && { technicianId: query.technicianId }) },
      include: fitmentExportInclude,
      orderBy: fitmentOrderBy(query),
      take: EXPORT_MAX_ROWS,
    });
    return writeFile(FITMENT_COLUMNS, fitments, query.format, `champ-fitments-${stamp}`, 'Fitments');
  }
  const tasks = await prisma.task.findMany({
    where: taskWhere(actor, query),
    include: exportInclude,
    orderBy: taskOrderBy(query),
    take: EXPORT_MAX_ROWS,
  });
  return writeFile(COLUMNS, tasks, query.format, `champ-tasks-${stamp}`, 'Tasks');
}

/** Writes rows as CSV (UTF-8 BOM) or Excel (bold, frozen header), every text cell through `safeText`. */
export async function writeFile<R>(columns: Column<R>[], items: R[], format: ExportFormat, base: string, sheetName: string): Promise<ExportFile> {
  const header = columns.map((c) => c.header);
  const rows = items.map((item) => columns.map((c) => safeText(c.value(item))));
  if (format === 'xlsx') {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Champ';
    const sheet = workbook.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = columns.map((c) => ({ header: c.header, width: c.width }));
    sheet.getRow(1).font = { bold: true };
    sheet.addRows(rows);
    return {
      filename: `${base}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: Buffer.from(await workbook.xlsx.writeBuffer()),
    };
  }
  // A UTF-8 BOM lets Excel open the CSV with the right encoding.
  return { filename: `${base}.csv`, contentType: 'text/csv; charset=utf-8', body: Buffer.from(`\uFEFF${toCsv(header, rows)}`) };
}
