import { describe, expect, it } from 'vitest';
import {
  EMPTY_FITMENT_FORM,
  FITMENT_CHECKS,
  fitmentFormSchema,
  missingForSubmit,
  placementLabel,
  requiredPhotoKinds,
  uploadTechnicianPhotoSchema,
  type FitmentFormDto,
} from '../src';

const allChecks = Object.fromEntries(FITMENT_CHECKS.map((c) => [c, 'OK'])) as FitmentFormDto['checks'];
const complete: FitmentFormDto = {
  ...EMPTY_FITMENT_FORM,
  vehicleRegNo: 'KA01AB1234',
  clusterReadingKm: 1200,
  deviceReplacement: 'NONE',
  deviceId: 'DEV1',
  checks: allChecks,
};

describe('requiredPhotoKinds (D-182)', () => {
  it.each([
    [false, null, ['BEFORE', 'ASSET', 'AFTER']],
    [false, 'NONE', ['BEFORE', 'ASSET', 'AFTER']],
    [false, 'DEVICE', ['BEFORE', 'ASSET', 'PLACEMENT', 'AFTER']],
    [false, 'SIM', ['BEFORE', 'ASSET', 'PLACEMENT', 'AFTER']],
    [true, null, ['BEFORE', 'ASSET', 'CLUSTER', 'AFTER']],
    [true, 'NONE', ['BEFORE', 'ASSET', 'CLUSTER', 'AFTER']],
    [true, 'DEVICE', ['BEFORE', 'ASSET', 'CLUSTER', 'PLACEMENT', 'AFTER']],
    [true, 'SIM', ['BEFORE', 'ASSET', 'CLUSTER', 'PLACEMENT', 'AFTER']],
  ] as const)('vehicle=%s replacement=%s', (isVehicle, deviceReplacement, kinds) => {
    expect(requiredPhotoKinds({ isVehicle, deviceReplacement })).toEqual(kinds);
  });

  it('labels the placement slot by the replacement', () => {
    expect(placementLabel('SIM')).toBe('SIM placement photo');
    expect(placementLabel('DEVICE')).toBe('Device placement photo');
    expect(placementLabel(null)).toBe('Device placement photo');
  });
});

describe('missingForSubmit (D-180/182/183)', () => {
  it('lists everything for an empty vehicle form, in form order', () => {
    expect(missingForSubmit(EMPTY_FITMENT_FORM, [], { isVehicle: true })).toEqual([
      'Before photo',
      'Asset photo',
      'Cluster reading photo',
      'Asset condition',
      'Accessories',
      'Vehicle battery condition',
      'Cluster meter reading',
      'CAN voltage',
      'Vehicle registration no.',
      'Cluster reading (km)',
      'Device replacement',
      'Device id',
      'After photo',
    ]);
  });

  it('does not need reg no., cluster reading or cluster photo for non-vehicles', () => {
    expect(missingForSubmit({ ...complete, vehicleRegNo: null, clusterReadingKm: null }, ['BEFORE', 'ASSET', 'AFTER'], { isVehicle: false })).toEqual([]);
  });

  it('is empty when a vehicle form is complete', () => {
    expect(missingForSubmit(complete, ['BEFORE', 'ASSET', 'CLUSTER', 'AFTER'], { isVehicle: true })).toEqual([]);
  });

  it('accepts a zero cluster reading', () => {
    expect(missingForSubmit({ ...complete, clusterReadingKm: 0 }, ['BEFORE', 'ASSET', 'CLUSTER', 'AFTER'], { isVehicle: true })).toEqual([]);
  });

  it('needs the placement photo with the right label when Device or SIM', () => {
    const photos = ['BEFORE', 'ASSET', 'AFTER'] as const;
    expect(missingForSubmit({ ...complete, deviceReplacement: 'SIM' }, photos, { isVehicle: false })).toEqual(['SIM placement photo']);
    expect(missingForSubmit({ ...complete, deviceReplacement: 'DEVICE' }, photos, { isVehicle: false })).toEqual(['Device placement photo']);
    expect(missingForSubmit({ ...complete, deviceReplacement: 'DEVICE' }, [...photos, 'PLACEMENT'], { isVehicle: false })).toEqual([]);
  });

  it('needs each check and the device id', () => {
    const { canVoltage: _, ...four } = allChecks;
    expect(missingForSubmit({ ...complete, checks: four, deviceId: null }, ['BEFORE', 'ASSET', 'AFTER'], { isVehicle: false })).toEqual([
      'CAN voltage',
      'Device id',
    ]);
  });
});

describe('fitmentFormSchema', () => {
  it('accepts a partial body, trims, upper-cases device ids and turns blanks into null', () => {
    expect(fitmentFormSchema.parse({ deviceId: '  ab12 ', chassisNo: '  ', checks: { canVoltage: 'NA', accessories: null } })).toEqual({
      deviceId: 'AB12',
      chassisNo: null,
      checks: { canVoltage: 'NA', accessories: null },
    });
    expect(fitmentFormSchema.parse({})).toEqual({});
  });

  it('refuses bad values', () => {
    for (const body of [
      { clusterReadingKm: -1 },
      { clusterReadingKm: 1.5 },
      { clusterReadingKm: 10_000_000 },
      { deviceReplacement: 'BOTH' },
      { deviceId: 'x'.repeat(65) },
      { chassisNo: 'x'.repeat(33) },
      { comments: 'x'.repeat(1001) },
      { checks: { canVoltage: 'MAYBE' } },
      { checks: { other: 'OK' } },
    ]) {
      expect(fitmentFormSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });
});

describe('uploadTechnicianPhotoSchema', () => {
  it('parses multipart strings', () => {
    expect(uploadTechnicianPhotoSchema.parse({ kind: 'BEFORE', lat: '12.5', lng: '77.1', takenAt: '2026-01-01T10:00:00.000Z' })).toEqual({
      kind: 'BEFORE',
      lat: 12.5,
      lng: 77.1,
      takenAt: '2026-01-01T10:00:00.000Z',
    });
    expect(uploadTechnicianPhotoSchema.parse({ kind: 'AFTER', lat: '', lng: '' })).toEqual({ kind: 'AFTER' });
  });

  it('refuses debug, one coordinate and future times', () => {
    expect(uploadTechnicianPhotoSchema.safeParse({ kind: 'DEBUG' }).success).toBe(false);
    expect(uploadTechnicianPhotoSchema.safeParse({ kind: 'BEFORE', lat: '12' }).success).toBe(false);
    const future = new Date(Date.now() + 10 * 60_000).toISOString();
    expect(uploadTechnicianPhotoSchema.safeParse({ kind: 'BEFORE', takenAt: future }).success).toBe(false);
    const nearFuture = new Date(Date.now() + 60_000).toISOString();
    expect(uploadTechnicianPhotoSchema.safeParse({ kind: 'BEFORE', takenAt: nearFuture }).success).toBe(true);
  });
});
