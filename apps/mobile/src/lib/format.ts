import { IST_TIME_ZONE, mobileDateOptions } from '@champ/shared';

export interface DateOption {
  value: string;
  label: string;
}

const dayFormat = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** `YYYY-MM-DD` → "Sat, 10 Oct" (the day itself, no time-zone shift). */
export function formatDay(day: string): string {
  return dayFormat.format(new Date(`${day}T00:00:00Z`));
}

/** The header picker (D-029): Today, Yesterday, then the dates, newest first. */
export function dateOptions(now: Date = new Date()): DateOption[] {
  return mobileDateOptions(now).map((value, i) => ({
    value,
    label: i === 0 ? 'Today' : i === 1 ? 'Yesterday' : formatDay(value),
  }));
}

export function dateLabel(day: string, now: Date = new Date()): string {
  return dateOptions(now).find((o) => o.value === day)?.label ?? formatDay(day);
}

const timeFormat = new Intl.DateTimeFormat('en-IN', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
  timeZone: IST_TIME_ZONE,
});

/** UTC ISO → "02:00 pm" in IST (D-065). */
export function formatIstTime(iso: string): string {
  return timeFormat.format(new Date(iso));
}
