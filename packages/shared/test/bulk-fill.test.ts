import { describe, expect, it } from 'vitest';
import {
  BULK_FILL_COLUMNS,
  TASK_EVENT_LABELS,
  bulkFillConfirmSchema,
  csvRowToForm,
  formHasValues,
  parseCheckCell,
  parseReplacementCell,
} from '../src';

describe('parseCheckCell', () => {
  it.each([
    ['OK', 'OK'],
    [' ok ', 'OK'],
    ['Not OK', 'NOT_OK'],
    ['NOT_OK', 'NOT_OK'],
    ['not-ok', 'NOT_OK'],
    ['NA', 'NA'],
    ['n/a', 'NA'],
    ['Not applicable', 'NA'],
  ])('%s → %s', (text, value) => {
    expect(parseCheckCell(text)).toEqual({ value });
  });

  it('names the allowed values on a typo', () => {
    expect(parseCheckCell('Nto OK')).toEqual({ error: 'Use OK, Not OK or NA' });
  });
});

describe('parseReplacementCell', () => {
  it.each([
    ['Device', 'DEVICE'],
    ['sim', 'SIM'],
    ['No', 'NONE'],
    ['NONE', 'NONE'],
  ])('%s → %s', (text, value) => {
    expect(parseReplacementCell(text)).toEqual({ value });
  });

  it('rejects anything else', () => {
    expect(parseReplacementCell('yes')).toEqual({ error: 'Use Device, SIM or No' });
  });
});

describe('csvRowToForm', () => {
  it('leaves blank cells out (D-205)', () => {
    const { form, errors } = csvRowToForm({ tk_id: 'TK-1', vehicle_reg_no: '  ', accessories: 'OK', comments: '' });
    expect(errors).toEqual([]);
    expect(form).toEqual({ checks: { accessories: 'OK' } });
    expect(formHasValues(form)).toBe(true);
    expect(formHasValues(csvRowToForm({ tk_id: 'TK-1' }).form)).toBe(false);
  });

  it('fills every column', () => {
    const { form, errors } = csvRowToForm({
      tk_id: '12',
      vehicle_reg_no: 'KA01AB1234',
      chassis_no: 'CH1',
      cluster_reading_km: '12,500',
      asset_condition: 'ok',
      accessories: 'Not OK',
      vehicle_battery_condition: 'NA',
      cluster_meter_reading: 'OK',
      can_voltage: 'n/a',
      device_replacement: 'Device',
      device_id: ' dev-01 ',
      secondary_device_id: 'sim9',
      comments: 'All good',
    });
    expect(errors).toEqual([]);
    expect(form).toEqual({
      vehicleRegNo: 'KA01AB1234',
      chassisNo: 'CH1',
      clusterReadingKm: 12500,
      checks: { assetCondition: 'OK', accessories: 'NOT_OK', batteryCondition: 'NA', clusterMeter: 'OK', canVoltage: 'NA' },
      deviceReplacement: 'DEVICE',
      deviceId: 'DEV-01',
      secondaryDeviceId: 'SIM9',
      comments: 'All good',
    });
  });

  it('reports per-cell errors with the schema rules', () => {
    const { form, errors } = csvRowToForm({
      cluster_reading_km: '12.5',
      vehicle_reg_no: 'X'.repeat(33),
      can_voltage: 'fine',
      device_replacement: 'maybe',
    });
    expect(form).toEqual({});
    expect(errors).toEqual([
      { column: 'vehicle_reg_no', message: 'Vehicle registration no. must be at most 32 characters' },
      { column: 'cluster_reading_km', message: 'Enter whole kilometres' },
      { column: 'can_voltage', message: 'CAN voltage: Use OK, Not OK or NA' },
      { column: 'device_replacement', message: 'Use Device, SIM or No' },
    ]);
    expect(csvRowToForm({ cluster_reading_km: 'abc' }).errors[0]?.message).toBe('Enter the reading in km');
    expect(csvRowToForm({ cluster_reading_km: '-5' }).errors[0]?.message).toBe('The reading cannot be negative');
    expect(csvRowToForm({ cluster_reading_km: '99999999' }).errors[0]?.column).toBe('cluster_reading_km');
  });
});

describe('contracts', () => {
  it('starts with tk_id and labels the event', () => {
    expect(BULK_FILL_COLUMNS[0]).toBe('tk_id');
    expect(TASK_EVENT_LABELS.FITMENT_FORM_CSV_FILLED).toBe('Filled from CSV');
  });

  it('confirm needs both lat and lng or neither', () => {
    const rows = [{ rowNumber: 2, tkId: 'TK-1', form: {} }];
    expect(bulkFillConfirmSchema.safeParse({ rows }).success).toBe(true);
    expect(bulkFillConfirmSchema.safeParse({ rows, lat: 12, lng: 77 }).success).toBe(true);
    expect(bulkFillConfirmSchema.safeParse({ rows, lat: 12 }).success).toBe(false);
    expect(bulkFillConfirmSchema.safeParse({ rows: [] }).success).toBe(false);
  });
});
