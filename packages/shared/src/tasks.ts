import type { Role } from './roles';

// --- Statuses (D-011, D-065) ---

/** Stored aggregate of a task's fitments (see `recomputeTaskStatus` in the API). */
export const TASK_STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  OPEN: 'Open',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
};

/** Every fitment state of the workflow (D-011). F04 only uses OPEN and ASSIGNED; F05 adds the transitions. */
export const FITMENT_STATUSES = [
  'OPEN',
  'ASSIGNED',
  'IN_PROGRESS',
  'SUBMITTED',
  'OE_VERIFIED',
  'OM_APPROVED',
  'CLOSED_NOT_DONE',
  'MOVED_TO_FT',
  'REOPENED',
] as const;
export type FitmentStatus = (typeof FITMENT_STATUSES)[number];

export const FITMENT_STATUS_LABELS: Record<FitmentStatus, string> = {
  OPEN: 'Open',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In progress',
  SUBMITTED: 'Submitted',
  OE_VERIFIED: 'OE verified',
  OM_APPROVED: 'OM approved',
  CLOSED_NOT_DONE: 'Closed – not done',
  MOVED_TO_FT: 'Moved to FT',
  REOPENED: 'Reopened',
};

/** Fitment states in which a fitment can still be assigned, unassigned or have its vehicle edited. */
export const ASSIGNABLE_FITMENT_STATUSES: readonly FitmentStatus[] = ['OPEN', 'ASSIGNED'];

/** Fitment states that end a fitment (a task whose fitments are all final is COMPLETED). */
export const FINAL_FITMENT_STATUSES: readonly FitmentStatus[] = ['OM_APPROVED', 'CLOSED_NOT_DONE', 'MOVED_TO_FT'];

export const isFitmentAssignable = (status: FitmentStatus): boolean => ASSIGNABLE_FITMENT_STATUSES.includes(status);

/** "Untouched" (edit and delete allowed): every fitment is still Open or Assigned. */
export const isTaskUntouched = (fitments: readonly { status: FitmentStatus }[]): boolean =>
  fitments.every((f) => isFitmentAssignable(f.status));

/** The task status implied by its fitment statuses (the rule behind `recomputeTaskStatus`). */
export function deriveTaskStatus(statuses: readonly FitmentStatus[]): TaskStatus {
  if (statuses.length === 0 || statuses.some((s) => s === 'OPEN')) return 'OPEN';
  if (statuses.every((s) => s === 'ASSIGNED')) return 'ASSIGNED';
  if (statuses.every((s) => FINAL_FITMENT_STATUSES.includes(s))) return 'COMPLETED';
  return 'IN_PROGRESS';
}

// --- Human ids (OM-00001, OE-00001, TK-00001) ---

export const TASK_ID_PREFIXES = ['OM', 'OE', 'TK'] as const;
export type TaskIdPrefix = (typeof TASK_ID_PREFIXES)[number];

/** `formatTaskId('OM', 1)` → `OM-00001`. Padded to 5 digits; longer numbers keep all their digits. */
export const formatTaskId = (prefix: TaskIdPrefix, n: number): string => `${prefix}-${String(n).padStart(5, '0')}`;
export const formatOmId = (n: number) => formatTaskId('OM', n);
export const formatOeId = (n: number) => formatTaskId('OE', n);
export const formatTkId = (n: number) => formatTaskId('TK', n);

export interface ParsedTaskId {
  /** Undefined for a bare number, which matches any of the three ids. */
  prefix?: TaskIdPrefix;
  number: number;
}

/**
 * Reads a task id typed into a search box: `OM-00001`, `om-1`, `TK1`, `tk 12` or a bare `1`.
 * Returns null when the text isn't an id.
 */
export function parseTaskId(text: string): ParsedTaskId | null {
  const match = /^(om|oe|tk)?[\s-]?(\d{1,9})$/i.exec(text.trim());
  if (!match) return null;
  const number = Number(match[2]);
  if (!Number.isSafeInteger(number) || number < 1) return null;
  const prefix = match[1]?.toUpperCase() as TaskIdPrefix | undefined;
  return prefix ? { prefix, number } : { number };
}

// --- Permissions (D-063, spec §3) ---

interface Actor {
  id?: string;
  role: Role;
}

/** Roles that can create tasks and use the bulk upload. */
export const TASK_CREATE_ROLES: readonly Role[] = ['SUPER_ADMIN', 'OM', 'OE'];

/** Roles that can open the task lists and details. OT gets 403 on every `/tasks` route. */
export const TASK_VIEW_ROLES: readonly Role[] = ['SUPER_ADMIN', 'OM', 'OE', 'RO'];

/** Roles that can delete an untouched task. */
export const TASK_DELETE_ROLES: readonly Role[] = ['SUPER_ADMIN', 'OM'];

export const canCreateTask = (user: Actor): boolean => TASK_CREATE_ROLES.includes(user.role);

export const canViewTasks = (user: Actor): boolean => TASK_VIEW_ROLES.includes(user.role);

/** Edit and assign: SA or OM for any task; an OE only for tasks where they are the operation executive. */
export function canManageTask(user: Actor, task: { oeId: string }): boolean {
  if (user.role === 'SUPER_ADMIN' || user.role === 'OM') return true;
  return user.role === 'OE' && !!user.id && task.oeId === user.id;
}

export const canDeleteTask = (user: Actor): boolean => TASK_DELETE_ROLES.includes(user.role);

// --- Times: stored in UTC, entered and shown in IST (D-065) ---

export const IST_TIME_ZONE = 'Asia/Kolkata';
/** India has no daylight saving time, so IST is always UTC+05:30. */
const IST_OFFSET_MS = 330 * 60_000;

const pad = (n: number) => String(n).padStart(2, '0');

/** The IST wall-clock parts of an instant. */
function istParts(date: Date) {
  const d = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    y: d.getUTCFullYear(),
    m: pad(d.getUTCMonth() + 1),
    d: pad(d.getUTCDate()),
    hh: pad(d.getUTCHours()),
    mm: pad(d.getUTCMinutes()),
  };
}

/**
 * Parses an IST wall-clock date-time, `YYYY-MM-DD HH:mm` or `YYYY-MM-DDTHH:mm` (the value of a
 * `datetime-local` input), into a Date. Returns null for anything else, including impossible dates.
 */
export function parseIstDateTime(text: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const [y, m, d, hh, mm] = match.slice(1).map(Number) as [number, number, number, number, number];
  if (m < 1 || m > 12 || d < 1 || d > 31 || hh > 23 || mm > 59) return null;
  const utc = Date.UTC(y, m - 1, d, hh, mm);
  const check = new Date(utc);
  if (check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null; // e.g. 2026-02-30
  return new Date(utc - IST_OFFSET_MS);
}

/** Start of an IST calendar day (`YYYY-MM-DD`) as an instant. */
export function istDayStart(day: string): Date | null {
  return parseIstDateTime(`${day} 00:00`);
}

/** `2026-10-11T08:30:00.000Z` → `2026-10-11 14:00` (IST), the CSV/export format. */
export function formatIstDateTime(value: Date | string): string {
  const { y, m, d, hh, mm } = istParts(new Date(value));
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

/** An instant as the value of a `datetime-local` input showing IST (`YYYY-MM-DDTHH:mm`). */
export function toIstInputValue(value: Date | string): string {
  return formatIstDateTime(value).replace(' ', 'T');
}

/** A `datetime-local` value entered in IST → ISO string; blank or invalid input gives ''. */
export function istInputToIso(value: string): string {
  return parseIstDateTime(value)?.toISOString() ?? '';
}

/** `YYYYMMDD-HHmm` in IST, used in export file names. */
export function istFileStamp(value: Date = new Date()): string {
  const { y, m, d, hh, mm } = istParts(value);
  return `${y}${m}${d}-${hh}${mm}`;
}

// --- CSV formats ---

/** Vehicle CSV of the create form (D-062): one row per vehicle, every column optional. */
export const VEHICLE_CSV_COLUMNS = {
  registration_number: 'vehicleRegNo',
  chassis_number: 'chassisNo',
  asset_number: 'assetNumber',
  old_device_id: 'oldDeviceId',
} as const;
export type VehicleCsvColumn = keyof typeof VEHICLE_CSV_COLUMNS;

/** Most vehicles (fitments) in one task. */
export const MAX_VEHICLES_PER_TASK = 500;

/** Bulk task CSV (D-064): one row per task. Header names are matched case-insensitively. */
export const BULK_TASK_COLUMNS = [
  'customer',
  'site',
  'oe_email',
  'technician_email',
  'technician_type',
  'asset_type',
  'activity',
  'device_type',
  'vehicle_make',
  'vehicle_model',
  'installation_type',
  'requested_fitment_at',
  'fitment_at',
  'shift_type',
  'vehicle_count',
  'issue_reported',
  'poc_name',
  'poc_phone',
  'poc_email',
  'gps_address',
  'comments',
] as const;
export type BulkTaskColumn = (typeof BULK_TASK_COLUMNS)[number];

/** Columns a bulk CSV must have in its header (the others may be left out). */
export const BULK_REQUIRED_COLUMNS: readonly BulkTaskColumn[] = [
  'customer',
  'site',
  'asset_type',
  'activity',
  'installation_type',
  'requested_fitment_at',
  'fitment_at',
  'shift_type',
  'vehicle_count',
  'issue_reported',
];

export const BULK_MAX_ROWS = 1000;
export const BULK_MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Lowercase, trim and turn spaces into underscores, so `Fitment At` matches `fitment_at`. */
export const normalizeCsvHeader = (header: string): string =>
  header.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/\s+/g, '_');

/** Escapes one CSV cell (RFC 4180 quoting). */
export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Builds CSV text from a header and rows (CRLF line ends, as Excel expects). */
export const toCsv = (header: readonly string[], rows: readonly (readonly unknown[])[]): string =>
  [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
