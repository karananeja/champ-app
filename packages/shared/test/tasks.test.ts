import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ROLES,
  assignFitmentsSchema,
  bulkImportSchema,
  canCreateTask,
  canDeleteTask,
  canManageTask,
  canViewTasks,
  createTaskSchema,
  createTaskSchemaFor,
  deriveTaskStatus,
  formatIstDateTime,
  formatOeId,
  formatOmId,
  formatTkId,
  istFileStamp,
  istInputToIso,
  isTaskUntouched,
  listTasksQuerySchema,
  normalizeCsvHeader,
  parseIstDateTime,
  parseTaskId,
  toCsv,
  toIstInputValue,
  updateFitmentSchema,
  updateTaskSchema,
  vehicleRowsFromCsv,
  vehiclesSchema,
  type Role,
} from '../src';

const fieldErrors = (result: { error?: z.ZodError }) => (result.error ? z.flattenError(result.error).fieldErrors : {});

const task = {
  clientId: 'cl-1',
  siteId: 'site-1',
  pocName: 'Priya',
  pocPhone: '+91 98765 43210',
  pocEmail: '',
  oeId: 'oe-1',
  technicianType: null,
  assetTypeId: 'at-vehicle',
  activityId: 'act-1',
  deviceTypeId: 'dt-laf5',
  makeModelId: 'mm-1',
  installationTypeId: 'it-gps',
  requestedAt: '2026-10-20T04:30:00.000Z',
  fitmentAt: '2026-10-21T05:00:00.000Z',
  shiftTypeId: 'shift-day',
  issueReportedId: 'issue-1',
  gpsAddress: '',
  comments: '',
  vehicles: { entry: 'COUNT', count: 3 },
};

describe('task ids', () => {
  it('formats OM/OE/TK ids padded to 5 digits, growing beyond', () => {
    expect(formatOmId(1)).toBe('OM-00001');
    expect(formatOeId(42)).toBe('OE-00042');
    expect(formatTkId(99999)).toBe('TK-99999');
    expect(formatTkId(123456)).toBe('TK-123456');
  });

  it.each([
    ['OM-00001', { prefix: 'OM', number: 1 }],
    ['om-1', { prefix: 'OM', number: 1 }],
    [' tk-1 ', { prefix: 'TK', number: 1 }],
    ['TK00012', { prefix: 'TK', number: 12 }],
    ['oe 7', { prefix: 'OE', number: 7 }],
    ['1', { number: 1 }],
    ['000123', { number: 123 }],
  ])('parses %j', (text, expected) => {
    expect(parseTaskId(text)).toEqual(expected);
  });

  it.each(['', 'OM-', 'XX-1', 'OM-0', '0', 'zoom', 'OM--1', '1.5', 'OM-1234567890'])('rejects %j', (text) => {
    expect(parseTaskId(text)).toBeNull();
  });
});

describe('task permissions', () => {
  const expected: Record<Role, { create: boolean; view: boolean; delete: boolean }> = {
    SUPER_ADMIN: { create: true, view: true, delete: true },
    OM: { create: true, view: true, delete: true },
    OE: { create: true, view: true, delete: false },
    RO: { create: false, view: true, delete: false },
    OT: { create: false, view: false, delete: false },
  };

  it.each(ROLES)('%s', (role) => {
    expect(canCreateTask({ role })).toBe(expected[role].create);
    expect(canViewTasks({ role })).toBe(expected[role].view);
    expect(canDeleteTask({ role })).toBe(expected[role].delete);
  });

  it('canManageTask: SA/OM any task, an OE only their own, RO/OT never', () => {
    const t = { oeId: 'oe-1' };
    expect(canManageTask({ id: 'x', role: 'SUPER_ADMIN' }, t)).toBe(true);
    expect(canManageTask({ id: 'x', role: 'OM' }, t)).toBe(true);
    expect(canManageTask({ id: 'oe-1', role: 'OE' }, t)).toBe(true);
    expect(canManageTask({ id: 'oe-2', role: 'OE' }, t)).toBe(false);
    expect(canManageTask({ role: 'OE' }, t)).toBe(false);
    expect(canManageTask({ id: 'oe-1', role: 'RO' }, t)).toBe(false);
    expect(canManageTask({ id: 'oe-1', role: 'OT' }, t)).toBe(false);
  });
});

describe('task status rules', () => {
  it('derives the task status from fitments', () => {
    expect(deriveTaskStatus(['OPEN', 'ASSIGNED'])).toBe('OPEN');
    expect(deriveTaskStatus(['ASSIGNED', 'ASSIGNED'])).toBe('ASSIGNED');
    expect(deriveTaskStatus(['ASSIGNED', 'IN_PROGRESS'])).toBe('IN_PROGRESS');
    expect(deriveTaskStatus(['OM_APPROVED', 'CLOSED_NOT_DONE', 'MOVED_TO_FT'])).toBe('COMPLETED');
    expect(deriveTaskStatus(['OM_APPROVED', 'REOPENED'])).toBe('IN_PROGRESS');
  });

  it('a task is untouched while every fitment is Open or Assigned', () => {
    expect(isTaskUntouched([{ status: 'OPEN' }, { status: 'ASSIGNED' }])).toBe(true);
    expect(isTaskUntouched([{ status: 'OPEN' }, { status: 'IN_PROGRESS' }])).toBe(false);
  });
});

describe('IST date-times', () => {
  it('parses YYYY-MM-DD HH:mm (or the datetime-local form) as IST', () => {
    expect(parseIstDateTime('2026-10-21 10:30')?.toISOString()).toBe('2026-10-21T05:00:00.000Z');
    expect(parseIstDateTime('2026-10-21T00:15')?.toISOString()).toBe('2026-10-20T18:45:00.000Z');
  });

  it.each(['', '21/10/2026 10:30', '2026-10-21', '2026-13-01 10:00', '2026-02-30 10:00', '2026-10-21 24:00', '2026-10-21 10:60'])(
    'rejects %j',
    (text) => {
      expect(parseIstDateTime(text)).toBeNull();
    },
  );

  it('formats instants in IST for CSV, inputs and file names', () => {
    expect(formatIstDateTime('2026-10-20T18:45:00.000Z')).toBe('2026-10-21 00:15');
    expect(toIstInputValue('2026-10-21T05:00:00.000Z')).toBe('2026-10-21T10:30');
    expect(istInputToIso('2026-10-21T10:30')).toBe('2026-10-21T05:00:00.000Z');
    expect(istInputToIso('')).toBe('');
    expect(istFileStamp(new Date('2026-10-11T18:31:00.000Z'))).toBe('20261012-0001');
  });
});

describe('vehicles schema', () => {
  it('accepts a count of 1–500', () => {
    expect(vehiclesSchema.safeParse({ entry: 'COUNT', count: 1 }).success).toBe(true);
    expect(vehiclesSchema.safeParse({ entry: 'COUNT', count: 500 }).success).toBe(true);
    for (const count of [0, 501, 2.5, '3']) {
      expect(vehiclesSchema.safeParse({ entry: 'COUNT', count }).success, String(count)).toBe(false);
    }
  });

  it('accepts 1–500 CSV rows with optional fields (blanks become null)', () => {
    const parsed = vehiclesSchema.parse({ entry: 'CSV', rows: [{ vehicleRegNo: ' KA01 ', chassisNo: '' }] });
    expect(parsed).toEqual({ entry: 'CSV', rows: [{ vehicleRegNo: 'KA01', chassisNo: null }] });
    expect(vehiclesSchema.safeParse({ entry: 'CSV', rows: [] }).error?.issues[0]?.message).toBe('The CSV has no vehicle rows');
    expect(vehiclesSchema.safeParse({ entry: 'CSV', rows: Array(501).fill({}) }).success).toBe(false);
    expect(vehiclesSchema.safeParse({ entry: 'CSV', rows: [{ chassisNo: 'x'.repeat(51) }] }).success).toBe(false);
  });

  it('rejects an unknown entry type', () => {
    expect(vehiclesSchema.safeParse({ entry: 'FILE', count: 2 }).error?.issues[0]?.message).toBe('Choose how to enter vehicles');
  });
});

describe('createTaskSchema', () => {
  it('accepts a full body and normalises blanks to null', () => {
    const parsed = createTaskSchema.parse(task);
    expect(parsed).toMatchObject({ pocEmail: null, gpsAddress: null, comments: null, vehicles: { entry: 'COUNT', count: 3 } });
  });

  it('reports friendly messages for missing fields', () => {
    const errors = fieldErrors(createTaskSchema.safeParse({ vehicles: { entry: 'COUNT', count: 1 } }));
    expect(errors).toMatchObject({
      clientId: ['Choose a customer'],
      siteId: ['Choose a site'],
      pocName: ['POC name is required'],
      oeId: ['Choose an operation executive'],
      fitmentAt: ['Choose the fitment date and time'],
      requestedAt: ['Choose the requested fitment date and time'],
      shiftTypeId: ['Choose a shift type'],
    });
    expect(fieldErrors(createTaskSchema.safeParse({ ...task, pocPhone: 'x', pocEmail: 'nope' }))).toEqual({
      pocPhone: ['Enter a valid phone number'],
      pocEmail: ['Enter a valid email address'],
    });
  });

  it('make/model rule: required for vehicles, not allowed otherwise', () => {
    const schema = createTaskSchemaFor((id) => id === 'at-vehicle');
    expect(schema.safeParse(task).success).toBe(true);
    expect(fieldErrors(schema.safeParse({ ...task, makeModelId: null }))).toEqual({ makeModelId: ['Choose the vehicle make/model'] });
    const battery = { ...task, assetTypeId: 'at-battery' };
    expect(fieldErrors(schema.safeParse(battery))).toEqual({ makeModelId: ['Make/model applies to vehicles only'] });
    expect(schema.safeParse({ ...battery, makeModelId: null }).success).toBe(true);
  });

  it('update needs at least one field; fitment updates and assignments are validated', () => {
    expect(updateTaskSchema.safeParse({}).success).toBe(false);
    expect(updateTaskSchema.parse({ comments: '' })).toEqual({ comments: null });
    expect(updateTaskSchema.safeParse({ fitmentAt: 'tomorrow' }).success).toBe(false);
    expect(updateFitmentSchema.safeParse({}).success).toBe(false);
    expect(updateFitmentSchema.parse({ chassisNo: '' })).toEqual({ chassisNo: null });
    expect(assignFitmentsSchema.safeParse({ fitmentIds: [], technicianId: null }).success).toBe(false);
    expect(assignFitmentsSchema.safeParse({ fitmentIds: ['f1'] }).success).toBe(false);
    expect(assignFitmentsSchema.parse({ fitmentIds: ['f1'], technicianId: null })).toEqual({ fitmentIds: ['f1'], technicianId: null });
  });

  it('list query defaults and validation', () => {
    expect(listTasksQuerySchema.parse({})).toEqual({ view: 'open', sort: 'fitmentAt:asc', page: 1, pageSize: 20 });
    expect(listTasksQuerySchema.safeParse({ view: 'mine' }).success).toBe(false);
    expect(listTasksQuerySchema.safeParse({ from: '2026-1-1' }).success).toBe(false);
    expect(bulkImportSchema.safeParse({ rows: [] }).success).toBe(false);
  });
});

describe('CSV helpers', () => {
  it('normalises headers', () => {
    expect(normalizeCsvHeader('\uFEFF Fitment At ')).toBe('fitment_at');
  });

  it('quotes cells that need it', () => {
    expect(toCsv(['a', 'b'], [['x,y', 'say "hi"'], [null, 3]])).toBe('a,b\r\n"x,y","say ""hi"""\r\n,3\r\n');
  });

  it('turns vehicle CSV records into vehicle rows', () => {
    const headers = ['registration_number', 'chassis_number', 'notes'];
    const { rows, errors } = vehicleRowsFromCsv(headers, [
      { registration_number: 'KA01', chassis_number: '' },
      { registration_number: '', chassis_number: 'CH2' },
    ]);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { vehicleRegNo: 'KA01', chassisNo: null, assetNumber: null, oldDeviceId: null },
      { vehicleRegNo: null, chassisNo: 'CH2', assetNumber: null, oldDeviceId: null },
    ]);
  });

  it('reports vehicle CSV problems', () => {
    expect(vehicleRowsFromCsv(['name'], [{ name: 'x' }]).errors[0]).toMatch(/^The header must have at least one of/);
    expect(vehicleRowsFromCsv(['chassis_number'], []).errors).toEqual(['The CSV has no vehicle rows']);
    expect(vehicleRowsFromCsv(['chassis_number'], Array(501).fill({ chassis_number: 'x' })).errors).toEqual([
      'At most 500 vehicles (the file has 501)',
    ]);
    expect(vehicleRowsFromCsv(['chassis_number'], [{ chassis_number: 'x'.repeat(51) }]).errors).toEqual([
      'Row 2: Chassis number must be at most 50 characters',
    ]);
  });
});
