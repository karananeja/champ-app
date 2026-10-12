import type { ExportFormat, TravelStatus } from '@champ/shared';
import { withQuery } from '@/lib/api';

/**
 * The Travel tasks filters (F08) and their URL form, as the board's (F07): they live in the search params so a
 * filtered list can be shared and reloaded (`/tasks/travel?status=RAISED&from=2026-10-01`), e.g. from the
 * dashboard's "Travel to verify" card. `tt` (the open detail) and `page` are kept separately.
 */
export interface TravelFilters {
  technicianId: string;
  oeId: string;
  clientId: string;
  locationId: string;
  status: TravelStatus | '';
  /** IST days, `YYYY-MM-DD`, both inclusive (travel date). */
  from: string;
  to: string;
  /** A TT id or number. */
  q: string;
}

export const TRAVEL_FILTER_KEYS = ['technicianId', 'oeId', 'clientId', 'locationId', 'status', 'from', 'to', 'q'] as const satisfies readonly (keyof TravelFilters)[];

export const EMPTY_TRAVEL_FILTERS: TravelFilters = { technicianId: '', oeId: '', clientId: '', locationId: '', status: '', from: '', to: '', q: '' };

export const travelFiltersFromParams = (params: URLSearchParams): TravelFilters =>
  Object.fromEntries(TRAVEL_FILTER_KEYS.map((k) => [k, params.get(k) ?? ''])) as unknown as TravelFilters;

/** The search params with these filters (empty ones left out); a filter change goes back to page 1. */
export function withTravelFilters(params: URLSearchParams, patch: Partial<TravelFilters>): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(patch)) {
    if (value?.trim()) next.set(key, value.trim());
    else next.delete(key);
  }
  next.delete('page');
  return next;
}

export const hasTravelFilters = (f: TravelFilters): boolean => TRAVEL_FILTER_KEYS.some((k) => f[k].trim() !== '');

/** The `GET /travel-tasks` query (unset filters left out). */
export const travelQuery = (f: TravelFilters): Record<string, string> =>
  Object.fromEntries(TRAVEL_FILTER_KEYS.map((k) => [k, f[k].trim()]).filter(([, v]) => v));

/** The export URL (under `/api`) for the current filters. */
export const travelExportPath = (f: TravelFilters, format: ExportFormat) => withQuery('/travel-tasks/export', { ...travelQuery(f), format });
