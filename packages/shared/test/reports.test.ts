import { describe, expect, it } from 'vitest';
import {
  addCalendarDays,
  analyticsQuerySchema,
  billingQuerySchema,
  canViewAnalytics,
  canViewBilling,
  daysInclusive,
  istDayOf,
  istMonthOf,
  istMonthRange,
  istWeekStart,
  percentiles,
  safeRatio,
} from '../src';

const HOUR = 3_600_000;

describe('reports (F15)', () => {
  it('roles: billing SA/OM/RO; analytics also OE', () => {
    expect((['SUPER_ADMIN', 'OM', 'OE', 'OT', 'RO'] as const).map((role) => [canViewBilling({ role }), canViewAnalytics({ role })])).toEqual([
      [true, true],
      [true, true],
      [false, true],
      [false, false],
      [true, true],
    ]);
  });

  it('IST days, months and Monday weeks', () => {
    expect(istDayOf('2026-09-30T18:20:00.000Z')).toBe('2026-09-30'); // 23:50 IST
    expect(istDayOf('2026-09-30T18:40:00.000Z')).toBe('2026-10-01'); // 00:10 IST
    expect(istMonthOf('2026-09-30T18:40:00.000Z')).toBe('2026-10');
    expect(istMonthRange('2026-12')).toEqual({ gte: new Date('2026-11-30T18:30:00.000Z'), lt: new Date('2026-12-31T18:30:00.000Z') });
    expect(istWeekStart('2026-10-12')).toBe('2026-10-12');
    expect(istWeekStart('2026-10-18')).toBe('2026-10-12');
    expect(istWeekStart('2026-11-01')).toBe('2026-10-26');
    expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysInclusive('2026-10-01', '2026-10-01')).toBe(1);
    expect(daysInclusive('2025-10-01', '2026-10-01')).toBe(366);
  });

  it('percentiles (median, nearest-rank P90, hours with one decimal) and ratios', () => {
    expect(percentiles([])).toEqual({ count: 0, medianHours: null, p90Hours: null });
    expect(percentiles([26, 2, 4.5, 3].map((h) => h * HOUR))).toEqual({ count: 4, medianHours: 3.8, p90Hours: 26 });
    expect(percentiles([1, 2, 3].map((h) => h * HOUR))).toEqual({ count: 3, medianHours: 2, p90Hours: 3 });
    expect(safeRatio(1, 3)).toBe(0.3333);
    expect(safeRatio(1, 0)).toBeNull();
  });

  it('query schemas: month format, range order and length', () => {
    expect(billingQuerySchema.parse({ month: '2026-09' })).toEqual({ month: '2026-09', format: 'json' });
    expect(billingQuerySchema.safeParse({ month: '2026-13' }).success).toBe(false);
    const ok = (from: string, to: string) => analyticsQuerySchema.safeParse({ from, to }).success;
    expect(ok('2026-10-01', '2026-10-31')).toBe(true);
    expect(ok('2026-10-31', '2026-10-01')).toBe(false);
    expect(ok('2025-10-01', '2026-10-01')).toBe(true);
    expect(ok('2025-10-01', '2026-10-02')).toBe(false);
    expect(ok('2026-02-30', '2026-03-01')).toBe(false);
  });
});
