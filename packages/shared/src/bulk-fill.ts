import { z } from 'zod';
import type { BulkCellError } from './dto';
import {
  CHECK_LABELS,
  fitmentFormSchema,
  type CheckValue,
  type DeviceReplacement,
  type FitmentCheck,
  type FitmentFormInput,
  type RequiredPhotoKind,
} from './fitment-form';
import type { MyFitmentDto } from './mobile';
import type { FitmentStatus } from './tasks';

/**
 * Mobile CSV bulk fill (F11): the technician fills the forms of their fitments of one task from a CSV, previews it
 * and confirms (D-021, D-201 – D-205). The API and the app use these contracts.
 */

/** CSV columns, in this order. tk_id is required in the header; the others are optional (a missing column = blank). */
export const BULK_FILL_COLUMNS = [
  'tk_id',
  'vehicle_reg_no',
  'chassis_no',
  'cluster_reading_km',
  'asset_condition',
  'accessories',
  'vehicle_battery_condition',
  'cluster_meter_reading',
  'can_voltage',
  'device_replacement',
  'device_id',
  'secondary_device_id',
  'comments',
] as const;
export type BulkFillColumn = (typeof BULK_FILL_COLUMNS)[number];
export const BULK_FILL_MAX_ROWS = 500;
export const BULK_FILL_MAX_BYTES = 1_000_000;

export type BulkFillCellError = BulkCellError<BulkFillColumn>;

/** The check columns and the form check each one fills. */
export const BULK_FILL_CHECK_COLUMNS = {
  asset_condition: 'assetCondition',
  accessories: 'accessories',
  vehicle_battery_condition: 'batteryCondition',
  cluster_meter_reading: 'clusterMeter',
  can_voltage: 'canVoltage',
} as const satisfies Partial<Record<BulkFillColumn, FitmentCheck>>;

/** Statuses a CSV row may fill (D-184; Assigned/Reopened are started on Confirm, D-202). */
export const BULK_FILL_STATUSES: readonly FitmentStatus[] = ['ASSIGNED', 'REOPENED', 'IN_PROGRESS', 'SUBMITTED'];
/** Statuses Confirm starts first. */
export const BULK_FILL_START_STATUSES: readonly FitmentStatus[] = ['ASSIGNED', 'REOPENED'];

export const GPS_REQUIRED_MESSAGE = 'Turn on location to start the fitments';

const norm = (text: string) => text.trim().toLowerCase().replace(/[\s_-]+/g, ' ');

const CHECK_SPELLINGS: Record<string, CheckValue> = {
  ok: 'OK',
  'not ok': 'NOT_OK',
  notok: 'NOT_OK',
  na: 'NA',
  'n/a': 'NA',
  'not applicable': 'NA',
};

const REPLACEMENT_SPELLINGS: Record<string, DeviceReplacement> = {
  device: 'DEVICE',
  sim: 'SIM',
  no: 'NONE',
  none: 'NONE',
};

/** Lenient check cell (case-insensitive, trimmed): OK, Not OK / NOT_OK, NA / N/A / Not applicable. */
export function parseCheckCell(text: string): { value: CheckValue } | { error: string } {
  const value = CHECK_SPELLINGS[norm(text)];
  return value ? { value } : { error: 'Use OK, Not OK or NA' };
}

/** Lenient device replacement cell: Device, SIM, No / None. */
export function parseReplacementCell(text: string): { value: DeviceReplacement } | { error: string } {
  const value = REPLACEMENT_SPELLINGS[norm(text)];
  return value ? { value } : { error: 'Use Device, SIM or No' };
}

const TEXT_COLUMNS = {
  vehicle_reg_no: 'vehicleRegNo',
  chassis_no: 'chassisNo',
  device_id: 'deviceId',
  secondary_device_id: 'secondaryDeviceId',
  comments: 'comments',
} as const satisfies Partial<Record<BulkFillColumn, keyof FitmentFormInput>>;

/**
 * One CSV row → a partial FitmentFormInput (blank cells are left out, D-205) plus per-cell errors. Uses
 * fitmentFormSchema's rules for lengths, the km range and device-id upper-casing.
 */
export function csvRowToForm(row: Partial<Record<BulkFillColumn, string>>): {
  form: FitmentFormInput;
  errors: BulkFillCellError[];
} {
  const form: FitmentFormInput = {};
  const errors: BulkFillCellError[] = [];
  const cell = (c: BulkFillColumn) => (row[c] ?? '').trim();
  const shape = fitmentFormSchema.shape;

  for (const [column, field] of Object.entries(TEXT_COLUMNS) as [keyof typeof TEXT_COLUMNS, (typeof TEXT_COLUMNS)[keyof typeof TEXT_COLUMNS]][]) {
    const text = cell(column);
    if (!text) continue;
    const parsed = shape[field].safeParse(text);
    if (parsed.success) form[field] = parsed.data;
    else errors.push({ column, message: parsed.error.issues[0]?.message ?? 'Invalid value' });
  }

  const km = cell('cluster_reading_km').replace(/[,\s]/g, '');
  if (km) {
    const parsed = /^-?\d+(\.\d+)?$/.test(km) ? shape.clusterReadingKm.safeParse(Number(km)) : null;
    if (parsed?.success) form.clusterReadingKm = parsed.data;
    else errors.push({ column: 'cluster_reading_km', message: parsed?.error.issues[0]?.message ?? 'Enter the reading in km' });
  }

  const checks: NonNullable<FitmentFormInput['checks']> = {};
  for (const [column, check] of Object.entries(BULK_FILL_CHECK_COLUMNS) as [keyof typeof BULK_FILL_CHECK_COLUMNS, FitmentCheck][]) {
    const text = cell(column);
    if (!text) continue;
    const parsed = parseCheckCell(text);
    if ('value' in parsed) checks[check] = parsed.value;
    else errors.push({ column, message: `${CHECK_LABELS[check]}: ${parsed.error}` });
  }
  if (Object.keys(checks).length > 0) form.checks = checks;

  const replacement = cell('device_replacement');
  if (replacement) {
    const parsed = parseReplacementCell(replacement);
    if ('value' in parsed) form.deviceReplacement = parsed.value;
    else errors.push({ column: 'device_replacement', message: parsed.error });
  }

  return { form, errors };
}

/** Whether a parsed row fills anything (a row with only tk_id fills nothing). */
export const formHasValues = (form: FitmentFormInput): boolean =>
  Object.entries(form).some(([k, v]) => (k === 'checks' ? Object.keys(v ?? {}).length > 0 : v !== undefined));

export interface BulkFillFitmentDto {
  /** photos: [] as in lists (D-185). */
  fitment: MyFitmentDto;
  /** missingForSubmit labels (empty = ready); for ASSIGNED/REOPENED fitments too. */
  missing: string[];
  /** Required photo kinds with no active photo, in walk-through order BEFORE, ASSET, CLUSTER, PLACEMENT, AFTER. */
  missingPhotos: RequiredPhotoKind[];
}

export interface BulkFillTaskDto {
  taskId: string;
  omId: string;
  customer: string;
  site: MyFitmentDto['site'];
  fitmentAt: string;
  /** The caller's fitments of the task, by seq. */
  fitments: BulkFillFitmentDto[];
}

export interface BulkFillPreviewRow {
  rowNumber: number;
  /** As written in the file. */
  tkId: string;
  fitmentId: string | null;
  /** What will be filled (blank cells left out). */
  form: FitmentFormInput;
  /** The fitment is Assigned/Reopened and will be started on Confirm. */
  willStart: boolean;
  /** column '' = the row. */
  errors: BulkFillCellError[];
  valid: boolean;
}

export interface BulkFillPreviewResponse {
  rows: BulkFillPreviewRow[];
  validCount: number;
  invalidCount: number;
  startCount: number;
}

export const bulkFillConfirmSchema = z
  .object({
    rows: z
      .array(z.object({ rowNumber: z.number().int(), tkId: z.string(), form: fitmentFormSchema }))
      .min(1, 'Send at least one row')
      .max(BULK_FILL_MAX_ROWS, `At most ${BULK_FILL_MAX_ROWS} rows`),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
  })
  .refine((v) => (v.lat === undefined) === (v.lng === undefined), {
    message: 'Send both lat and lng, or neither',
    path: ['lat'],
  });
export type BulkFillConfirmInput = z.infer<typeof bulkFillConfirmSchema>;

export interface BulkFillConfirmResponse {
  /** TK ids. */
  filled: string[];
  started: string[];
  failed: { rowNumber: number; tkId: string; code: string; message: string }[];
}

export interface SubmitReadyResponse {
  submitted: string[];
  incomplete: { tkId: string; missing: string[] }[];
  /** Not In progress (already submitted, verified, closed…): left alone. */
  skipped: string[];
}
