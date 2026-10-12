import { describe, expect, it } from 'vitest';
import {
  HOME_LOCATION_REQUIRED_ROLES,
  MOBILE_PAST_DAYS,
  MOBILE_ROLES,
  isHomeLocationRequired,
  isMobileRole,
  mobileDateOptions,
  mobileDateQuerySchema,
  mobileRefreshSchema,
  setHomeLocationSchema,
} from '../src';

describe('mobile roles (D-128, D-129)', () => {
  it('only OT and OE use the field app; only OT must set a home location', () => {
    expect(MOBILE_ROLES).toEqual(['OT', 'OE']);
    expect(HOME_LOCATION_REQUIRED_ROLES).toEqual(['OT']);
    expect(['SUPER_ADMIN', 'OM', 'RO'].some((r) => isMobileRole(r as 'OM'))).toBe(false);
    expect(isMobileRole('OE')).toBe(true);
    expect(isHomeLocationRequired('OT')).toBe(true);
    expect(isHomeLocationRequired('OE')).toBe(false);
    expect(MOBILE_PAST_DAYS).toBe(7);
  });
});

describe('mobileDateOptions', () => {
  it('lists today and the 7 days before it in IST, newest first', () => {
    expect(mobileDateOptions(new Date('2026-10-12T06:00:00Z'))).toEqual([
      '2026-10-12',
      '2026-10-11',
      '2026-10-10',
      '2026-10-09',
      '2026-10-08',
      '2026-10-07',
      '2026-10-06',
      '2026-10-05',
    ]);
  });

  it('switches day at IST midnight, not UTC midnight', () => {
    expect(mobileDateOptions(new Date('2026-10-11T18:29:59Z'))[0]).toBe('2026-10-11'); // 23:59:59 IST
    expect(mobileDateOptions(new Date('2026-10-11T18:30:00Z'))[0]).toBe('2026-10-12'); // 00:00 IST
    expect(mobileDateOptions(new Date('2026-10-11T18:45:00Z'))[0]).toBe('2026-10-12');
    expect(mobileDateOptions(new Date('2026-10-12T20:00:00Z'))[0]).toBe('2026-10-13');
  });

  it('crosses month and year boundaries', () => {
    expect(mobileDateOptions(new Date('2027-01-02T00:00:00Z'))).toEqual([
      '2027-01-02',
      '2027-01-01',
      '2026-12-31',
      '2026-12-30',
      '2026-12-29',
      '2026-12-28',
      '2026-12-27',
      '2026-12-26',
    ]);
  });
});

describe('mobile schemas', () => {
  it('home location bounds and address length', () => {
    const ok = { lat: 12.97, lng: 77.59, address: '  MG Road ' };
    expect(setHomeLocationSchema.parse(ok).address).toBe('MG Road');
    for (const [lat, lng] of [[-90, -180], [90, 180]] as const) {
      expect(setHomeLocationSchema.safeParse({ ...ok, lat, lng }).success).toBe(true);
    }
    for (const bad of [
      { ...ok, lat: 90.01 },
      { ...ok, lat: -90.01 },
      { ...ok, lng: 180.01 },
      { ...ok, lng: -180.01 },
      { ...ok, address: '  ab  ' },
      { ...ok, address: 'a'.repeat(301) },
      { ...ok, lat: '12.97' },
    ]) {
      expect(setHomeLocationSchema.safeParse(bad).success).toBe(false);
    }
    expect(setHomeLocationSchema.safeParse({ ...ok, address: 'a'.repeat(300) }).success).toBe(true);
  });

  it('refresh body needs a token', () => {
    expect(mobileRefreshSchema.safeParse({ refreshToken: 'abc' }).success).toBe(true);
    expect(mobileRefreshSchema.safeParse({ refreshToken: '' }).success).toBe(false);
    expect(mobileRefreshSchema.safeParse({}).success).toBe(false);
  });

  it('date query accepts only the window', () => {
    const options = mobileDateOptions(new Date());
    expect(mobileDateQuerySchema.safeParse({ date: options[0] }).success).toBe(true);
    expect(mobileDateQuerySchema.safeParse({ date: options.at(-1) }).success).toBe(true);
    const before = new Date(Date.parse(`${options.at(-1)}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const after = new Date(Date.parse(`${options[0]}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    for (const date of [before, after, 'today', '2026-1-1', undefined]) {
      expect(mobileDateQuerySchema.safeParse({ date }).success).toBe(false);
    }
  });
});
