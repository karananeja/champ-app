import { z } from 'zod';
import type { FitmentStatus, TaskStatus } from './tasks';
import type { TravelStatus } from './travel';

/**
 * Global search (F14, D-242–D-246): one box that finds tasks, fitments and travel tasks by the ids people read
 * off a device, a vehicle or a call. The identifier set is fixed; the SA switches each one on or off and orders
 * them for ranking.
 */

// --- Identifiers (D-242, D-243) ---

/** Every searchable identifier, in the default ranking order. */
export const SEARCH_IDENTIFIERS = [
  'OM_ID',
  'OE_TASK_ID',
  'TK_ID',
  'TT_ID',
  'DEVICE_ID',
  'SECONDARY_DEVICE_ID',
  'OLD_DEVICE_ID',
  'CHASSIS_NO',
  'ASSET_NO',
  'VEHICLE_REG_NO',
] as const;
export type SearchIdentifier = (typeof SEARCH_IDENTIFIERS)[number];

export const SEARCH_IDENTIFIER_LABELS: Record<SearchIdentifier, string> = {
  OM_ID: 'OM id',
  OE_TASK_ID: 'OE task id',
  TK_ID: 'TK id',
  TT_ID: 'Travel task id',
  DEVICE_ID: 'Device id',
  SECONDARY_DEVICE_ID: 'Secondary device id',
  OLD_DEVICE_ID: 'Old device id',
  CHASSIS_NO: 'Chassis no.',
  ASSET_NO: 'Asset no.',
  VEHICLE_REG_NO: 'Vehicle reg. no.',
};

/** Identifiers matched by their number, exactly (`OM-00045`, `oe 45`, a bare `45`). */
export const SEARCH_NUMBERED_IDENTIFIERS: readonly SearchIdentifier[] = ['OM_ID', 'OE_TASK_ID', 'TK_ID', 'TT_ID'];

/** Identifiers matched by "contains" on the normalized text (D-245). */
export const SEARCH_TEXT_IDENTIFIERS: readonly SearchIdentifier[] = [
  'DEVICE_ID',
  'SECONDARY_DEVICE_ID',
  'OLD_DEVICE_ID',
  'CHASSIS_NO',
  'ASSET_NO',
  'VEHICLE_REG_NO',
];

/** Minimum normalized length for a "contains" search; ids parse at any length. */
export const SEARCH_MIN_CHARS = 3;
/** Results shown in the top-bar dialog. */
export const SEARCH_MAX_RESULTS = 20;

// --- Matching (D-245) ---

/** Lower-case, spaces and hyphens removed: the form both sides are compared in (D-245). */
export function normalizeIdentifier(text: string): string {
  return text.toLowerCase().replace(/[\s-]/g, '');
}

export type SearchIdPrefix = 'OM' | 'OE' | 'TK' | 'TT';

export interface ParsedSearchId {
  /** Undefined for a bare number, which matches OM, OE and TK ids (not TT). */
  prefix?: SearchIdPrefix;
  number: number;
}

/** OM/OE/TK/TT id or a bare number (→ OM, OE and TK), else null. Extends parseTaskId with TT. */
export function parseSearchId(text: string): ParsedSearchId | null {
  const match = /^(om|oe|tk|tt)?[\s-]?(\d{1,9})$/i.exec(text.trim());
  if (!match) return null;
  const number = Number(match[2]);
  if (!Number.isSafeInteger(number) || number < 1) return null;
  const prefix = match[1]?.toUpperCase() as SearchIdPrefix | undefined;
  return prefix ? { prefix, number } : { number };
}

// --- Request schemas ---

export const globalSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(100).default(SEARCH_MAX_RESULTS),
});
export type GlobalSearchQuery = z.infer<typeof globalSearchQuerySchema>;

/** The whole list in ranking order: every identifier exactly once, at least one switched on. */
export const updateSearchIdentifiersSchema = z.object({
  items: z
    .array(z.object({ identifier: z.enum(SEARCH_IDENTIFIERS), enabled: z.boolean() }))
    .length(SEARCH_IDENTIFIERS.length)
    .refine((items) => new Set(items.map((i) => i.identifier)).size === SEARCH_IDENTIFIERS.length, {
      message: 'List every identifier exactly once',
    })
    .refine((items) => items.some((i) => i.enabled), { message: 'Keep at least one identifier on' }),
});
export type UpdateSearchIdentifiersInput = z.infer<typeof updateSearchIdentifiersSchema>;

// --- Responses ---

export interface SearchMatch {
  identifier: SearchIdentifier;
  /** The stored value, as stored (e.g. `LAF5-00123`, `OM-00045`). */
  value: string;
}

export interface SearchFitmentHit {
  fitmentId: string;
  tkId: string;
  status: FitmentStatus;
  vehicleRegNo: string | null;
  matches: SearchMatch[];
}

export interface SearchTaskHit {
  kind: 'TASK';
  taskId: string;
  omId: string;
  oeTaskId: string;
  customer: string;
  site: string;
  status: TaskStatus;
  /** Task-level matches (OM id, OE task id). */
  matches: SearchMatch[];
  /** Fitments that matched (empty when only the task matched). */
  fitments: SearchFitmentHit[];
}

export interface SearchTravelHit {
  kind: 'TRAVEL';
  travelTaskId: string;
  ttId: string;
  technician: string;
  status: TravelStatus;
  matches: SearchMatch[];
}

export type SearchHit = SearchTaskHit | SearchTravelHit;

export interface GlobalSearchResponse {
  q: string;
  hits: SearchHit[];
  /** Fitment + task-only + travel hits before the limit. */
  total: number;
  truncated: boolean;
}

export interface SearchIdentifierSettingDto {
  identifier: SearchIdentifier;
  label: string;
  enabled: boolean;
  sortOrder: number;
}
