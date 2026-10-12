import { z } from 'zod';
import { isoDay } from './mobile';
import type { Role } from './roles';
import { istDayStart, type FitmentStatus } from './tasks';

/**
 * Reports (F15, D-264–D-268): the monthly billing report and the operations analytics (KPIs). Times are stored
 * in UTC; months, days and weeks are IST.
 */

// --- Permissions (D-266) ---

export const REPORT_ROLES_BILLING: readonly Role[] = ['SUPER_ADMIN', 'OM', 'RO'];
export const REPORT_ROLES_ANALYTICS: readonly Role[] = ['SUPER_ADMIN', 'OM', 'OE', 'RO'];

export const canViewBilling = (actor: { role: Role }): boolean => REPORT_ROLES_BILLING.includes(actor.role);
export const canViewAnalytics = (actor: { role: Role }): boolean => REPORT_ROLES_ANALYTICS.includes(actor.role);

// --- IST calendar helpers ---

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** The IST calendar day (`YYYY-MM-DD`) of an instant. */
export const istDayOf = (value: Date | string): string => new Date(new Date(value).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

/** The IST month (`YYYY-MM`) of an instant. */
export const istMonthOf = (value: Date | string): string => istDayOf(value).slice(0, 7);

/** `YYYY-MM-DD` plus `n` calendar days. */
export function addCalendarDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Calendar days from `from` to `to`, inclusive (1 for the same day). */
export const daysInclusive = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS) + 1;

/** The Monday (`YYYY-MM-DD`) of the week of an IST day. */
export function istWeekStart(day: string): string {
  const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay(); // 0 = Sunday
  return addCalendarDays(day, -((weekday + 6) % 7));
}

/** [start, end) instants of IST days `from`..`to` inclusive. */
export function istDayRangeInstants(from: string, to: string): { gte: Date; lt: Date } {
  const gte = istDayStart(from);
  const end = istDayStart(addCalendarDays(to, 1));
  if (!gte || !end) throw new Error(`Invalid IST range ${from}..${to}`);
  return { gte, lt: end };
}

/** [start, end) instants of an IST month (`YYYY-MM`). */
export function istMonthRange(month: string): { gte: Date; lt: Date } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  const gte = istDayStart(`${month}-01`);
  const lt = istDayStart(`${next}-01`);
  if (!gte || !lt) throw new Error(`Invalid month ${month}`);
  return { gte, lt };
}

// --- Billing (D-264, D-268) ---

export const billingQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM'),
  clientId: z.string().optional(),
  format: z.enum(['json', 'csv', 'xlsx']).default('json'),
});
export type BillingQuery = z.infer<typeof billingQuerySchema>;

export interface BillingRow {
  fitmentId: string;
  tkId: string;
  taskId: string;
  omId: string;
  site: string;
  vehicleRegNo: string | null;
  chassisNo: string | null;
  deviceId: string | null;
  activity: string;
  technician: string | null;
  finalIssue: string | null;
  verifiedAt: string | null;
  approvedAt: string;
}

export interface BillingClientGroup {
  clientId: string;
  client: string;
  billableCount: number;
  nonBillableCount: number;
  rows: BillingRow[];
}

export interface BillingReportResponse {
  month: string;
  clients: BillingClientGroup[];
  totals: { billable: number; nonBillable: number };
}

// --- Analytics (D-265) ---

/** Longest analytics range, in days. */
export const MAX_ANALYTICS_RANGE_DAYS = 366;

export const analyticsQuerySchema = z
  .object({
    from: isoDay, // IST days, inclusive
    to: isoDay,
    clientId: z.string().optional(),
    oeId: z.string().optional(),
    regionId: z.string().optional(),
    format: z.enum(['json', 'csv']).default('json'),
    table: z.enum(['technicians', 'oes']).optional(), // csv: which table
  })
  .superRefine((q, ctx) => {
    if (!istDayStart(q.from) || !istDayStart(q.to)) {
      ctx.addIssue({ code: 'custom', message: 'Invalid date', path: ['from'] });
      return;
    }
    if (q.from > q.to) ctx.addIssue({ code: 'custom', message: 'From must be on or before to', path: ['to'] });
    else if (daysInclusive(q.from, q.to) > MAX_ANALYTICS_RANGE_DAYS) {
      ctx.addIssue({ code: 'custom', message: `Choose at most ${MAX_ANALYTICS_RANGE_DAYS} days`, path: ['to'] });
    }
  });
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

export interface Percentiles {
  count: number;
  medianHours: number | null;
  p90Hours: number | null;
}

export interface TechnicianKpiRow {
  user: { id: string; name: string };
  started: number;
  submitted: number;
  workingDays: number;
  fitmentsPerDay: number | null;
  reopens: number;
  reopenRate: number | null;
  movedToFt: number;
  faultyRate: number | null;
  km: number;
  kmApprox: boolean;
  fieldTat: Percentiles;
}

export interface OeKpiRow {
  user: { id: string; name: string };
  verified: number;
  reopens: number;
  reopenRate: number | null;
  endToEndTat: Percentiles;
}

export interface WeeklyPoint {
  weekStart: string /* IST Monday */;
  submitted: number;
  approved: number;
  reopens: number;
  movedToFt: number;
  started: number;
  km: number;
}

export interface AnalyticsResponse {
  from: string;
  to: string;
  /** Fitments whose task date is in the range, by current status. */
  statusCounts: { status: FitmentStatus; count: number }[];
  turnaround: { field: Percentiles; endToEnd: Percentiles };
  reopenRate: { reopens: number; submitted: number; rate: number | null };
  fitmentsPerTechnicianPerDay: { submitted: number; technicianDays: number; average: number | null };
  faultyRate: { movedToFt: number; started: number; rate: number | null };
  km: { total: number; approx: boolean };
  weekly: WeeklyPoint[];
  /** Sorted by name. */
  technicians: TechnicianKpiRow[];
  /** Only themself for an OE viewer. */
  oes: OeKpiRow[];
}

// --- Math helpers ---

/** `a ÷ b`, or null when `b` is 0. Rounded to 4 decimals. */
export const safeRatio = (a: number, b: number): number | null => (b === 0 ? null : Math.round((a / b) * 10_000) / 10_000);

/** Median and P90 (nearest rank) of durations in milliseconds, as hours with one decimal. */
export function percentiles(durationsMs: readonly number[]): Percentiles {
  const sorted = [...durationsMs].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return { count: 0, medianHours: null, p90Hours: null };
  const hours = (ms: number) => Math.round(ms / 360_000) / 10;
  const median = n % 2 === 1 ? sorted[(n - 1) / 2]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
  const p90 = sorted[Math.ceil(0.9 * n) - 1]!;
  return { count: n, medianHours: hours(median), p90Hours: hours(p90) };
}
