import { istToday } from '@/lib/dates';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** `YYYY-MM` shifted by `n` months. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const index = y * 12 + (m - 1) + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** Default billing month (F15 §5): the previous month during the first 5 IST days of a month, else the current one. */
export function defaultBillingMonth(today: string = istToday()): string {
  const month = today.slice(0, 7);
  return Number(today.slice(8, 10)) <= 5 ? addMonths(month, -1) : month;
}

/** "October 2026". */
export function formatMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** The current month and the 23 before it, newest first (the billing month picker). */
export function recentMonths(today: string = istToday(), count = 24): string[] {
  const current = today.slice(0, 7);
  return Array.from({ length: count }, (_, i) => addMonths(current, -i));
}

/** This IST month so far: the 1st to today (the analytics default range). */
export function thisMonthRange(today: string = istToday()): { from: string; to: string } {
  return { from: `${today.slice(0, 8)}01`, to: today };
}

/** "12.5%" or "–" for no data (rates are fractions). */
export const formatRate = (rate: number | null): string => (rate === null ? '–' : `${(Math.round(rate * 1000) / 10).toLocaleString('en-IN')}%`);

/** "4.2 h" or "–". */
export const formatHours = (hours: number | null): string => (hours === null ? '–' : `${hours.toLocaleString('en-IN')} h`);

/** A plain number with Indian grouping, one decimal at most, or "–". */
export const formatNumber = (value: number | null): string =>
  value === null ? '–' : (Math.round(value * 10) / 10).toLocaleString('en-IN');

/** "≈ 120 km" when approximate (straight lines), else "120 km". */
export const formatKm = (km: number, approx: boolean): string => `${approx ? '≈ ' : ''}${formatNumber(km)} km`;

/** "6 Oct" for a week start. */
export function formatShortDay(day: string): string {
  const [, m, d] = day.split('-').map(Number) as [number, number, number];
  return `${d} ${MONTH_NAMES[m - 1]!.slice(0, 3)}`;
}

export type SortDir = 'asc' | 'desc';

/** Sorts rows by a value getter; nulls go last in both directions; strings compare by locale. */
export function sortRows<T>(rows: readonly T[], get: (row: T) => string | number | null, dir: SortDir): T[] {
  return [...rows].sort((a, b) => {
    const x = get(a);
    const y = get(b);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    const cmp = typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y) : Number(x) - Number(y);
    return dir === 'asc' ? cmp : -cmp;
  });
}
