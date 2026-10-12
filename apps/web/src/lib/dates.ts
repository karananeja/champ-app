import { IST_TIME_ZONE } from '@champ/shared';

/**
 * Calendar-day helpers for the date pickers (CR-04). Pickers hold IST wall-clock strings, the same values the
 * API takes: a day is `YYYY-MM-DD`, a date-time `YYYY-MM-DDTHH:mm` (see the shared `istInputToIso`). The
 * calendar itself works on local `Date`s at midnight, used only as "which day", so the browser's time zone never
 * shifts the value.
 */

const pad = (n: number) => String(n).padStart(2, '0');
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;

/** `2026-10-12` → a local Date on that day (midnight); null when blank or invalid. */
export function dayToDate(day: string): Date | null {
  const m = DAY_RE.exec(day);
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return date.getMonth() === Number(m[2]) - 1 ? date : null;
}

/** A local Date → its calendar day, `YYYY-MM-DD`. */
export const dateToDay = (date: Date): string => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const istDayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: IST_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Today's date in IST, `YYYY-MM-DD`. */
export const istToday = (now: Date = new Date()): string => istDayFormat.format(now);

const dayLabelFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** `2026-10-12` → `12 Oct 2026`; '' when blank or invalid. */
export function formatDay(day: string): string {
  const date = dayToDate(day);
  return date ? dayLabelFormat.format(date) : '';
}

/** A from/to range as shown on a trigger: `1 Oct 2026 – 12 Oct 2026`, `From 1 Oct 2026`, `Until 12 Oct 2026`. */
export function formatDayRange(from: string, to: string): string {
  if (from && to) return from === to ? formatDay(from) : `${formatDay(from)} – ${formatDay(to)}`;
  if (from) return `From ${formatDay(from)}`;
  if (to) return `Until ${formatDay(to)}`;
  return '';
}

export interface DateTimeParts {
  day: string;
  hour: string;
  minute: string;
}

/** `2026-10-12T10:30` → `{ day: '2026-10-12', hour: '10', minute: '30' }`; null when blank or invalid. */
export function splitDateTime(value: string): DateTimeParts | null {
  const m = DATE_TIME_RE.exec(value);
  if (!m || !dayToDate(m[1]!)) return null;
  if (Number(m[2]) > 23 || Number(m[3]) > 59) return null;
  return { day: m[1]!, hour: m[2]!, minute: m[3]! };
}

export const joinDateTime = ({ day, hour, minute }: DateTimeParts): string => `${day}T${hour}:${minute}`;

/** `2026-10-12T10:30` → `12 Oct 2026, 10:30` (the same style as `formatIst`); '' when blank or invalid. */
export function formatDateTimeValue(value: string): string {
  const parts = splitDateTime(value);
  return parts ? `${formatDay(parts.day)}, ${parts.hour}:${parts.minute}` : '';
}

export const HOURS: string[] = Array.from({ length: 24 }, (_, h) => pad(h));
/** Minutes in 5-minute steps (CR-04). */
export const MINUTES: string[] = Array.from({ length: 12 }, (_, i) => pad(i * 5));

/** A from/to range of IST days (`YYYY-MM-DD` or '' when open-ended). */
export interface DayRange {
  from: string;
  to: string;
}

/**
 * The range after clicking `day`: a click starts a new range (from = day) unless only "from" is set, in which
 * case it ends the range (the earlier of the two days becomes "from").
 */
export function nextRange(current: DayRange, day: string): DayRange {
  if (!current.from || current.to) return { from: day, to: '' };
  return day < current.from ? { from: day, to: current.from } : { from: current.from, to: day };
}
