import type { Role } from './roles';

/** Simple masters stored in the shared `LookupItem` table (D-047). */
export const LOOKUP_KINDS = [
  'ASSET_TYPE',
  'DEVICE_TYPE',
  'INSTALLATION_TYPE',
  'STATE',
  'REGION',
  'ISSUE_REPORTED',
  'ISSUE_OBSERVED',
  'ACTION_TAKEN',
  'FINAL_ISSUE',
  'ACCESSORY',
  'CLOSE_REASON',
  'SHIFT_TYPE',
  'TASK_TYPE',
] as const;
export type LookupKind = (typeof LOOKUP_KINDS)[number];

export const LOOKUP_KIND_LABELS: Record<LookupKind, { plural: string; singular: string }> = {
  ASSET_TYPE: { plural: 'Asset types', singular: 'Asset type' },
  DEVICE_TYPE: { plural: 'Device types', singular: 'Device type' },
  INSTALLATION_TYPE: { plural: 'Installation types', singular: 'Installation type' },
  STATE: { plural: 'States', singular: 'State' },
  REGION: { plural: 'Regions', singular: 'Region' },
  ISSUE_REPORTED: { plural: 'Issues reported', singular: 'Issue reported' },
  ISSUE_OBSERVED: { plural: 'Issues observed', singular: 'Issue observed' },
  ACTION_TAKEN: { plural: 'Actions taken', singular: 'Action taken' },
  FINAL_ISSUE: { plural: 'Final issues', singular: 'Final issue' },
  ACCESSORY: { plural: 'Accessories', singular: 'Accessory' },
  CLOSE_REASON: { plural: 'Close reasons', singular: 'Close reason' },
  SHIFT_TYPE: { plural: 'Shift types', singular: 'Shift type' },
  TASK_TYPE: { plural: 'Task types', singular: 'Task type' },
};

/** `FINAL_ISSUE` ⇄ `final-issue` (the URL form used by `/masters/lookup/:kind`). */
export const lookupKindToSlug = (kind: LookupKind): string => kind.toLowerCase().replaceAll('_', '-');

export function lookupKindFromSlug(slug: string): LookupKind | null {
  const kind = slug.toUpperCase().replaceAll('-', '_');
  return (LOOKUP_KINDS as readonly string[]).includes(kind) ? (kind as LookupKind) : null;
}

/** Built-in task types (D-013) and the descriptions shown next to their codes. */
export const TASK_TYPE_DESCRIPTIONS: Record<string, string> = {
  OT: 'Operation task',
  TT: 'Travel task',
  FT: 'Faulty task',
};

export const TECHNICIAN_TYPES = ['PAYROLL', 'THIRD_PARTY', 'CONTRACTUAL'] as const;
export type TechnicianType = (typeof TECHNICIAN_TYPES)[number];

export const TECHNICIAN_TYPE_LABELS: Record<TechnicianType, string> = {
  PAYROLL: 'Payroll',
  THIRD_PARTY: 'Third party',
  CONTRACTUAL: 'Contractual',
};

/** Case- and whitespace-insensitive key used for duplicate detection. */
export const toNameKey = (name: string): string => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** Uniqueness key of a vehicle make/model pair. */
export const toMakeModelKey = (make: string, model: string): string => `${toNameKey(make)}|${toNameKey(model)}`;

// --- Permissions (pure checks shared by web and API) ---

interface Actor {
  id?: string;
  role: Role;
  canManageTaskTypes?: boolean;
}

/**
 * Roles that can open the Masters admin pages and read `/masters/*` (D-059, CR-01). Everyone signed in can
 * still read the active values through `GET /lookups`.
 */
export const MASTERS_VIEW_ROLES: readonly Role[] = ['SUPER_ADMIN', 'OM'];

/** SA or OM may view the Masters admin (pages and `/masters/*` reads). */
export const canViewMasters = (user: Actor): boolean => MASTERS_VIEW_ROLES.includes(user.role);

/** SA or OM may add, edit and deactivate master data. */
export const canEditMasters = (user: Actor): boolean => user.role === 'SUPER_ADMIN' || user.role === 'OM';

/** Task types: SA, or an OM with the "Delegate task types" flag. */
export const canEditTaskTypes = (user: Actor): boolean =>
  user.role === 'SUPER_ADMIN' || (user.role === 'OM' && !!user.canManageTaskTypes);

/** Edit rights for one `LookupItem` kind. */
export const canEditLookupKind = (user: Actor, kind: LookupKind): boolean =>
  kind === 'TASK_TYPE' ? canEditTaskTypes(user) : canEditMasters(user);

/** Roles that can open the Technicians page (`GET /technicians`). */
export const TECHNICIAN_LIST_ROLES: readonly Role[] = ['SUPER_ADMIN', 'OM', 'OE', 'RO'];

/** Roles that can add a technician (`POST /technicians`). */
export const TECHNICIAN_CREATE_ROLES: readonly Role[] = ['SUPER_ADMIN', 'OM', 'OE'];

export const canViewTechnicians = (user: Actor): boolean => TECHNICIAN_LIST_ROLES.includes(user.role);

export const canAddTechnician = (user: Actor): boolean => TECHNICIAN_CREATE_ROLES.includes(user.role);

/** SA or OM for any technician; an OE only for their own reportees. */
export function canManageTechnician(actor: Actor, tech: { managerId: string | null }): boolean {
  if (actor.role === 'SUPER_ADMIN' || actor.role === 'OM') return true;
  return actor.role === 'OE' && !!actor.id && tech.managerId === actor.id;
}
