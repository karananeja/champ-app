import { describe, expect, it } from 'vitest';
import {
  OPEN_ROUTE_STATUSES,
  mobileDateOptions,
  nextStopId,
  recalculateRouteSchema,
  routeOrderMessage,
  routeQuerySchema,
} from '../src';

const today = mobileDateOptions(new Date())[0]!;

describe('nextStopId (D-156)', () => {
  it('is null without open stops', () => {
    expect(nextStopId([])).toBeNull();
  });
  it('is the first open stop in route order', () => {
    expect(
      nextStopId([
        { id: 'a', status: 'REOPENED' },
        { id: 'b', status: 'ASSIGNED' },
      ]),
    ).toBe('a');
  });
  it('an IN_PROGRESS stop is always next', () => {
    expect(
      nextStopId([
        { id: 'a', status: 'ASSIGNED' },
        { id: 'b', status: 'IN_PROGRESS' },
      ]),
    ).toBe('b');
  });
  it('skips stops that are not open', () => {
    expect(
      nextStopId([
        { id: 'a', status: 'SUBMITTED' },
        { id: 'b', status: 'ASSIGNED' },
      ]),
    ).toBe('b');
  });
  it('open statuses and message', () => {
    expect(OPEN_ROUTE_STATUSES).toEqual(['ASSIGNED', 'REOPENED', 'IN_PROGRESS']);
    expect(routeOrderMessage('TK-00001')).toBe('Finish or close TK-00001 first');
  });
});

describe('routeQuerySchema', () => {
  it('accepts both coordinates or neither (coerced from the query string)', () => {
    expect(routeQuerySchema.safeParse({ date: today }).success).toBe(true);
    expect(routeQuerySchema.parse({ date: today, lat: '12.9', lng: '77.6' })).toEqual({ date: today, lat: 12.9, lng: 77.6 });
    expect(routeQuerySchema.safeParse({ date: today, lat: '12.9' }).success).toBe(false);
    expect(routeQuerySchema.safeParse({ date: today, lng: '77.6' }).success).toBe(false);
    expect(routeQuerySchema.safeParse({ date: today, lat: '91', lng: '0' }).success).toBe(false);
  });
  it('limits the date to the window', () => {
    expect(routeQuerySchema.safeParse({ date: '2001-01-01' }).success).toBe(false);
    expect(routeQuerySchema.safeParse({ date: mobileDateOptions(new Date())[7] }).success).toBe(true);
  });
});

describe('recalculateRouteSchema', () => {
  it('requires the GPS position and a date in the window', () => {
    expect(recalculateRouteSchema.safeParse({ date: today, lat: 12.9, lng: 77.6 }).success).toBe(true);
    expect(recalculateRouteSchema.safeParse({ date: today }).success).toBe(false);
    expect(recalculateRouteSchema.safeParse({ date: today, lat: 12.9 }).success).toBe(false);
    expect(recalculateRouteSchema.safeParse({ date: today, lat: 12.9, lng: 181 }).success).toBe(false);
    expect(recalculateRouteSchema.safeParse({ date: '2001-01-01', lat: 1, lng: 1 }).success).toBe(false);
  });
});
