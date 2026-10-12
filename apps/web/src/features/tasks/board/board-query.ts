/**
 * The board filters (F07) and their URL form: they live in the search params so a view can be shared and
 * reloaded (`/tasks/board?clientId=…&from=2026-10-01&q=TK-12`).
 */
export interface BoardFilters {
  clientId: string;
  oeId: string;
  technicianId: string;
  activityId: string;
  /** IST days, `YYYY-MM-DD`, both inclusive (fitment date). */
  from: string;
  to: string;
  /** A TK, OM or OE id. */
  q: string;
}

export const BOARD_FILTER_KEYS = ['clientId', 'oeId', 'technicianId', 'activityId', 'from', 'to', 'q'] as const satisfies readonly (keyof BoardFilters)[];

export const filtersFromParams = (params: URLSearchParams): BoardFilters =>
  Object.fromEntries(BOARD_FILTER_KEYS.map((k) => [k, params.get(k) ?? ''])) as unknown as BoardFilters;

/** The search params for these filters; empty filters are left out, other params (e.g. `col`) are kept. */
export function withFilters(params: URLSearchParams, patch: Partial<BoardFilters>): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(patch)) {
    if (value?.trim()) next.set(key, value.trim());
    else next.delete(key);
  }
  return next;
}

/** The `GET /board` query (unset filters left out). */
export const boardQuery = (f: BoardFilters): Record<string, string> =>
  Object.fromEntries(BOARD_FILTER_KEYS.map((k) => [k, f[k].trim()]).filter(([, v]) => v));

export const hasBoardFilters = (f: BoardFilters): boolean => BOARD_FILTER_KEYS.some((k) => f[k].trim() !== '');
