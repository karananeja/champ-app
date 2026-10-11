/**
 * Bulk task CSV rows (D-064): maps one row of readable values (customer code or name, site name, emails,
 * master names) to a `CreateTaskInput`, collecting a message per bad cell. Used by both the preview and the
 * import, so they always agree. All lookups match case-insensitively against active values.
 */
import {
  BULK_TASK_COLUMNS,
  MAX_VEHICLES_PER_TASK,
  TECHNICIAN_TYPES,
  TECHNICIAN_TYPE_LABELS,
  createTaskSchema,
  normalizeCsvHeader,
  parseIstDateTime,
  toNameKey,
  type BulkCellError,
  type BulkTaskColumn,
  type CreateTaskInput,
  type LookupClient,
  type LookupOption,
  type LookupsResponse,
  type TechnicianType,
} from '@champ/shared';
import { prisma, type User } from '../../lib/prisma';
import { getLookups } from '../masters/lookups';

export type BulkRowData = Record<BulkTaskColumn, string>;

interface Person {
  id: string;
  name: string;
  email: string;
  technicianType: TechnicianType | null;
}

/** Everything a row is matched against, loaded once per preview or import. */
export interface BulkContext {
  actor: User;
  lookups: LookupsResponse;
  oes: Person[];
  technicians: Person[];
}

export async function loadBulkContext(actor: User): Promise<BulkContext> {
  const select = { id: true, name: true, email: true, technicianType: true } as const;
  const [lookups, oes, technicians] = await Promise.all([
    getLookups(),
    prisma.user.findMany({ where: { role: 'OE', status: 'ACTIVE' }, select, orderBy: { name: 'asc' } }),
    prisma.user.findMany({ where: { role: 'OT', status: 'ACTIVE' }, select, orderBy: { name: 'asc' } }),
  ]);
  return { actor, lookups, oes, technicians };
}

/** Keeps the known columns of a parsed row (headers normalised, values trimmed; missing → ''). */
export function normalizeBulkRow(raw: Record<string, unknown>): BulkRowData {
  const byHeader = new Map(Object.entries(raw).map(([k, v]) => [normalizeCsvHeader(k), typeof v === 'string' ? v.trim() : '']));
  return Object.fromEntries(BULK_TASK_COLUMNS.map((col) => [col, byHeader.get(col) ?? ''])) as BulkRowData;
}

/** API field (schema path or service field error) → CSV column, for mapping server messages onto cells. */
export const FIELD_TO_COLUMN: Record<string, BulkTaskColumn> = {
  clientId: 'customer',
  siteId: 'site',
  oeId: 'oe_email',
  technicianId: 'technician_email',
  technicianType: 'technician_type',
  assetTypeId: 'asset_type',
  activityId: 'activity',
  deviceTypeId: 'device_type',
  makeModelId: 'vehicle_make',
  installationTypeId: 'installation_type',
  requestedAt: 'requested_fitment_at',
  fitmentAt: 'fitment_at',
  shiftTypeId: 'shift_type',
  vehicles: 'vehicle_count',
  issueReportedId: 'issue_reported',
  pocName: 'poc_name',
  pocPhone: 'poc_phone',
  pocEmail: 'poc_email',
  gpsAddress: 'gps_address',
  comments: 'comments',
};

const keyOf = (text: string) => toNameKey(text);
const sameText = (a: string | null | undefined, b: string) => !!a && keyOf(a) === keyOf(b);

/** An active option whose name (or code) matches `text`. */
const findOption = <T extends LookupOption>(options: readonly T[], text: string) =>
  options.find((o) => sameText(o.name, text)) ?? options.find((o) => sameText(o.code, text));

const findClient = (clients: readonly LookupClient[], text: string) =>
  clients.find((c) => sameText(c.code, text)) ?? clients.find((c) => sameText(c.name, text));

/** `payroll`, `Third party`, `THIRD_PARTY` or `third-party` → the enum value. */
function parseTechnicianType(text: string): TechnicianType | null {
  const key = keyOf(text.replace(/[_-]/g, ' '));
  return TECHNICIAN_TYPES.find((t) => keyOf(TECHNICIAN_TYPE_LABELS[t]) === key) ?? null;
}

export interface BulkRowResult {
  input: CreateTaskInput | null;
  errors: BulkCellError[];
}

/** Validates one bulk row; `input` is set only when the row has no errors. */
export function validateBulkRow(ctx: BulkContext, row: BulkRowData): BulkRowResult {
  const errors: BulkCellError[] = [];
  const fail = (column: BulkTaskColumn, message: string) => {
    errors.push({ column, message });
    return null;
  };
  const required = (column: BulkTaskColumn) => (row[column] ? row[column] : fail(column, 'Required'));
  const { lookups, actor } = ctx;

  // Customer and site
  const clientText = required('customer');
  const client = clientText ? (findClient(lookups.clients, clientText) ?? fail('customer', `No active customer "${clientText}"`)) : null;
  const siteText = required('site');
  const site =
    client && siteText
      ? (client.sites.find((s) => sameText(s.name, siteText)) ?? fail('site', `No active site "${siteText}" for ${client.name}`))
      : null;

  // Operation executive: blank means yourself for an OE; SA and OM must name one.
  let oeId: string | null = null;
  const oeEmail = row.oe_email.toLowerCase();
  if (actor.role === 'OE') {
    if (oeEmail && oeEmail !== actor.email) fail('oe_email', 'You can only create tasks for yourself; leave it blank');
    else oeId = actor.id;
  } else if (!oeEmail) {
    fail('oe_email', 'Required');
  } else {
    oeId = ctx.oes.find((o) => o.email === oeEmail)?.id ?? fail('oe_email', `No active OE with email ${row.oe_email}`);
  }

  // Technician (optional) and type
  let technicianType: TechnicianType | null = null;
  if (row.technician_type) {
    technicianType =
      parseTechnicianType(row.technician_type) ?? fail('technician_type', 'Use Payroll, Third party or Contractual');
  }
  let technicianId: string | null = null;
  if (row.technician_email) {
    const tech = ctx.technicians.find((t) => t.email === row.technician_email.toLowerCase());
    if (!tech) {
      fail('technician_email', `No active technician with email ${row.technician_email}`);
    } else if (technicianType && tech.technicianType !== technicianType) {
      fail('technician_email', `${tech.name} isn't a ${TECHNICIAN_TYPE_LABELS[technicianType]} technician`);
    } else {
      technicianId = tech.id;
      technicianType ??= tech.technicianType;
    }
  }

  // Asset, activity, device and make/model
  const assetText = required('asset_type');
  const assetType = assetText ? (findOption(lookups.assetTypes, assetText) ?? fail('asset_type', `No active asset type "${assetText}"`)) : null;
  const activityText = required('activity');
  const activity =
    assetType && activityText
      ? (findOption(
          lookups.activities.filter((a) => a.assetTypeId === assetType.id),
          activityText,
        ) ?? fail('activity', `No active activity "${activityText}" for ${assetType.name}`))
      : null;
  const deviceType = row.device_type
    ? (findOption(lookups.deviceTypes, row.device_type) ?? fail('device_type', `No active device type "${row.device_type}"`))
    : (lookups.deviceTypes.find((d) => d.code === 'LAF5') ?? fail('device_type', 'Required (LAF5 is not available)'));

  let makeModelId: string | null = null;
  if (assetType?.code === 'VEHICLE') {
    const make = required('vehicle_make');
    const model = required('vehicle_model');
    if (make && model) {
      makeModelId =
        lookups.makeModels.find((m) => sameText(m.make, make) && sameText(m.model, model))?.id ??
        fail('vehicle_model', `No active make/model "${make} ${model}"`);
    }
  } else if (assetType && (row.vehicle_make || row.vehicle_model)) {
    fail(row.vehicle_make ? 'vehicle_make' : 'vehicle_model', 'Only for Vehicle assets; leave it blank');
  }

  const installText = required('installation_type');
  const installationType = installText
    ? (findOption(lookups.installationTypes, installText) ?? fail('installation_type', `No active installation type "${installText}"`))
    : null;

  // Schedule
  const dateOf = (column: 'requested_fitment_at' | 'fitment_at') => {
    const text = required(column);
    if (!text) return null;
    return parseIstDateTime(text)?.toISOString() ?? fail(column, 'Use YYYY-MM-DD HH:mm (IST), e.g. 2026-10-15 10:30');
  };
  const requestedAt = dateOf('requested_fitment_at');
  const fitmentAt = dateOf('fitment_at');
  const shiftText = required('shift_type');
  const shiftType = shiftText ? (findOption(lookups.shiftTypes, shiftText) ?? fail('shift_type', `No active shift type "${shiftText}"`)) : null;

  const countText = required('vehicle_count');
  let count: number | null = null;
  if (countText) {
    const n = /^\d+$/.test(countText) ? Number(countText) : NaN;
    if (n >= 1 && n <= MAX_VEHICLES_PER_TASK) count = n;
    else fail('vehicle_count', `Enter a whole number from 1 to ${MAX_VEHICLES_PER_TASK}`);
  }

  const issueText = required('issue_reported');
  const issue = issueText ? (findOption(lookups.issuesReported, issueText) ?? fail('issue_reported', `No active issue "${issueText}"`)) : null;

  if (errors.length > 0) return { input: null, errors };

  const candidate = {
    clientId: client!.id,
    siteId: site!.id,
    pocName: row.poc_name || client!.contactName,
    pocPhone: row.poc_phone || client!.contactPhone,
    pocEmail: row.poc_email,
    oeId: oeId!,
    technicianType,
    assetTypeId: assetType!.id,
    activityId: activity!.id,
    deviceTypeId: deviceType!.id,
    makeModelId,
    installationTypeId: installationType!.id,
    requestedAt: requestedAt!,
    fitmentAt: fitmentAt!,
    shiftTypeId: shiftType!.id,
    issueReportedId: issue!.id,
    gpsAddress: row.gps_address,
    comments: row.comments,
    vehicles: { entry: 'COUNT' as const, count: count! },
    technicianId,
  };
  const parsed = createTaskSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      input: null,
      errors: parsed.error.issues.map((issue) => ({
        column: FIELD_TO_COLUMN[String(issue.path[0])] ?? '',
        message: issue.message,
      })),
    };
  }
  return { input: parsed.data, errors: [] };
}
