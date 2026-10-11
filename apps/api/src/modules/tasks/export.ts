import ExcelJS from 'exceljs';
import {
  TASK_STATUS_LABELS,
  TECHNICIAN_TYPE_LABELS,
  formatIstDateTime,
  formatOeId,
  formatOmId,
  istFileStamp,
  toCsv,
  type ExportTasksQuery,
} from '@champ/shared';
import type { Prisma } from '../../generated/prisma/client';
import { prisma, type User } from '../../lib/prisma';
import { countFitments } from './dto';
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
  fitments: { select: { status: true, technicianId: true, technician: { select: { name: true } } }, orderBy: { seq: 'asc' } },
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

/** `GET /tasks/export`: the list filters without paging (capped at 10,000 rows), as CSV or Excel. */
export async function exportTasks(actor: User, query: ExportTasksQuery): Promise<ExportFile> {
  const tasks = await prisma.task.findMany({
    where: taskWhere(actor, query),
    include: exportInclude,
    orderBy: taskOrderBy(query.sort),
    take: EXPORT_MAX_ROWS,
  });
  const header = COLUMNS.map((c) => c.header);
  const rows = tasks.map((t) => COLUMNS.map((c) => safeText(c.value(t))));
  const base = `champ-tasks-${istFileStamp()}`;

  if (query.format === 'xlsx') {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Champ';
    const sheet = workbook.addWorksheet('Tasks', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = COLUMNS.map((c) => ({ header: c.header, width: c.width }));
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
