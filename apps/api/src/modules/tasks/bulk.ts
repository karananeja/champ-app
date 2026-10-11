import Papa from 'papaparse';
import {
  BULK_MAX_ROWS,
  BULK_REQUIRED_COLUMNS,
  BULK_TASK_COLUMNS,
  TECHNICIAN_TYPE_LABELS,
  formatIstDateTime,
  normalizeCsvHeader,
  toCsv,
  type BulkCellError,
  type BulkImportInput,
  type BulkImportResponse,
  type BulkPreviewResponse,
  type BulkPreviewRow,
  type BulkTaskColumn,
} from '@champ/shared';
import { HttpError, badRequest } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type { User } from '../../lib/prisma';
import { FIELD_TO_COLUMN, loadBulkContext, normalizeBulkRow, validateBulkRow, type BulkRowData } from './bulk-rows';
import { createTask } from './service';

const invalidFile = (message: string) => badRequest('VALIDATION_ERROR', message, { fieldErrors: { file: [message] } });

/**
 * Parses an uploaded bulk CSV with papaparse (header row, trimmed values, empty lines skipped). The header
 * must have every required column; at most 1,000 data rows. Row numbers count the header as row 1.
 */
export function parseBulkCsv(buffer: Buffer): { rowNumber: number; data: BulkRowData }[] {
  if (buffer.includes(0)) throw invalidFile('Upload a CSV file (this looks like a binary file)');
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: normalizeCsvHeader,
    transform: (value) => value.trim(),
  });
  const headers = parsed.meta.fields ?? [];
  const missing = BULK_REQUIRED_COLUMNS.filter((col) => !headers.includes(col));
  if (missing.length > 0) throw invalidFile(`Missing column(s): ${missing.join(', ')}. Download the sample for the format.`);
  if (parsed.data.length === 0) throw invalidFile('The file has no task rows');
  if (parsed.data.length > BULK_MAX_ROWS) {
    throw invalidFile(`At most ${BULK_MAX_ROWS} rows per file (this one has ${parsed.data.length})`);
  }
  return parsed.data.map((raw, i) => ({ rowNumber: i + 2, data: normalizeBulkRow(raw) }));
}

/** `POST /tasks/bulk/preview`: validates every row and writes nothing. */
export async function previewBulk(actor: User, buffer: Buffer): Promise<BulkPreviewResponse> {
  const rows = parseBulkCsv(buffer);
  const ctx = await loadBulkContext(actor);
  const preview: BulkPreviewRow[] = rows.map(({ rowNumber, data }) => {
    const { errors } = validateBulkRow(ctx, data);
    return { rowNumber, data, errors, valid: errors.length === 0 };
  });
  const validCount = preview.filter((r) => r.valid).length;
  return { rows: preview, validCount, invalidCount: preview.length - validCount };
}

/** Maps an error from `createTask` onto the row's cells. */
function errorsFrom(err: unknown): BulkCellError[] {
  if (!(err instanceof HttpError)) {
    logger.error({ err }, 'Bulk import: unexpected error');
    return [{ column: '', message: 'Could not create this task' }];
  }
  const fieldErrors = (err.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors ?? {};
  const cells = Object.entries(fieldErrors).flatMap(([field, messages]) =>
    (messages ?? []).map((message): BulkCellError => ({ column: FIELD_TO_COLUMN[field.split('.')[0]!] ?? '', message })),
  );
  return cells.length > 0 ? cells : [{ column: '', message: err.message }];
}

/**
 * `POST /tasks/bulk/import`: validates the rows again and creates the valid ones, each task in its own
 * transaction, so one bad row never blocks the others.
 */
export async function importBulk(actor: User, input: BulkImportInput): Promise<BulkImportResponse> {
  const ctx = await loadBulkContext(actor);
  const result: BulkImportResponse = { created: [], failed: [] };
  for (const { rowNumber, data } of input.rows) {
    const { input: task, errors } = validateBulkRow(ctx, normalizeBulkRow(data));
    if (!task) {
      result.failed.push({ rowNumber, errors });
      continue;
    }
    try {
      const created = await createTask(actor, task);
      result.created.push({ rowNumber, id: created.id, omId: created.omId });
    } catch (err) {
      result.failed.push({ rowNumber, errors: errorsFrom(err) });
    }
  }
  return result;
}

/** An IST date-time `days` from now at `hour`:`minute`. */
function istAt(days: number, hour: number, minute = 0): string {
  const day = formatIstDateTime(new Date(Date.now() + days * 86_400_000)).slice(0, 10);
  return `${day} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** `GET /tasks/bulk/sample`: the header plus two example rows built from real active values. */
export async function bulkSampleCsv(actor: User): Promise<string> {
  const { lookups, oes, technicians } = await loadBulkContext(actor);
  const client = lookups.clients.find((c) => c.sites.length > 0);
  const vehicle = lookups.assetTypes.find((a) => a.code === 'VEHICLE') ?? lookups.assetTypes[0];
  const battery = lookups.assetTypes.find((a) => a.code === 'BATTERY');
  const activityFor = (assetTypeId?: string) => lookups.activities.find((a) => a.assetTypeId === assetTypeId)?.name ?? '';
  const makeModel = lookups.makeModels[0];
  const oeEmail = actor.role === 'OE' ? '' : (oes[0]?.email ?? 'oe@example.com');
  const tech = technicians.find((t) => t.technicianType);
  const name = (list: { name: string }[], i = 0) => list[i]?.name ?? list[0]?.name ?? '';

  const base: Partial<Record<BulkTaskColumn, string>> = {
    customer: client?.code ?? client?.name ?? 'Customer code or name',
    site: client?.sites[0]?.name ?? 'Site name',
    oe_email: oeEmail,
    device_type: lookups.deviceTypes.find((d) => d.code === 'LAF5')?.name ?? name(lookups.deviceTypes),
    installation_type: name(lookups.installationTypes),
    issue_reported: name(lookups.issuesReported),
  };
  const rows: Partial<Record<BulkTaskColumn, string>>[] = [
    {
      ...base,
      technician_email: tech?.email ?? '',
      technician_type: tech?.technicianType ? TECHNICIAN_TYPE_LABELS[tech.technicianType] : '',
      asset_type: vehicle?.name ?? 'Vehicle',
      activity: activityFor(vehicle?.id),
      vehicle_make: makeModel?.make ?? '',
      vehicle_model: makeModel?.model ?? '',
      requested_fitment_at: istAt(1, 10),
      fitment_at: istAt(2, 10, 30),
      shift_type: name(lookups.shiftTypes),
      vehicle_count: '3',
      comments: 'Example row: vehicles with a technician',
    },
    {
      ...base,
      asset_type: battery?.name ?? 'Battery',
      activity: activityFor(battery?.id),
      requested_fitment_at: istAt(2, 9),
      fitment_at: istAt(3, 21),
      shift_type: name(lookups.shiftTypes, 1),
      vehicle_count: '2',
      poc_name: 'Site supervisor',
      poc_phone: '+91 90000 00000',
      gps_address: 'Gate 2, loading bay',
      comments: 'Example row: batteries, technician assigned later',
    },
  ];
  return toCsv(
    BULK_TASK_COLUMNS,
    rows.map((row) => BULK_TASK_COLUMNS.map((col) => row[col] ?? '')),
  );
}
