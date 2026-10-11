import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  LOOKUP_KINDS,
  MASTERS_VIEW_ROLES,
  ROLES,
  canAddTechnician,
  canEditLookupKind,
  canEditMasters,
  canEditTaskTypes,
  canManageTechnician,
  canViewMasters,
  canViewTechnicians,
  createActivitySchema,
  createInviteSchema,
  createLocationSchema,
  createLookupItemSchema,
  createMakeModelSchema,
  createTechnicianSchema,
  listTechniciansQuerySchema,
  lookupKindFromSlug,
  lookupKindToSlug,
  masterListQuerySchema,
  toMakeModelKey,
  toNameKey,
  updateLookupItemSchema,
  updateTechnicianSchema,
  type Role,
} from '../src';

const fieldErrors = (result: { error?: z.ZodError }) => (result.error ? z.flattenError(result.error).fieldErrors : {});

describe('master permissions', () => {
  const editors: Role[] = ['SUPER_ADMIN', 'OM'];

  for (const role of ROLES) {
    it(`${role} ${editors.includes(role) ? 'can' : 'cannot'} edit masters`, () => {
      expect(canEditMasters({ role })).toBe(editors.includes(role));
    });
  }

  it('only SA and OM can view the masters admin (CR-01)', () => {
    expect(ROLES.filter((role) => canViewMasters({ role }))).toEqual(['SUPER_ADMIN', 'OM']);
    expect(MASTERS_VIEW_ROLES).toEqual(['SUPER_ADMIN', 'OM']);
    for (const role of ['OE', 'OT', 'RO'] as const) expect(canViewMasters({ role })).toBe(false);
  });

  it('every role that can edit masters can also view them', () => {
    for (const role of ROLES) if (canEditMasters({ role })) expect(canViewMasters({ role })).toBe(true);
  });

  it('task types: SA always, OM only with delegation, nobody else', () => {
    expect(canEditTaskTypes({ role: 'SUPER_ADMIN' })).toBe(true);
    expect(canEditTaskTypes({ role: 'OM' })).toBe(false);
    expect(canEditTaskTypes({ role: 'OM', canManageTaskTypes: false })).toBe(false);
    expect(canEditTaskTypes({ role: 'OM', canManageTaskTypes: true })).toBe(true);
    for (const role of ['OE', 'OT', 'RO'] as const) {
      expect(canEditTaskTypes({ role, canManageTaskTypes: true })).toBe(false);
    }
  });

  it('canEditLookupKind uses the task-type rule only for TASK_TYPE', () => {
    const om = { role: 'OM' as const, canManageTaskTypes: false };
    for (const kind of LOOKUP_KINDS) {
      expect(canEditLookupKind(om, kind)).toBe(kind !== 'TASK_TYPE');
    }
    expect(canEditLookupKind({ ...om, canManageTaskTypes: true }, 'TASK_TYPE')).toBe(true);
  });

  it('technicians: who can view, add and manage', () => {
    expect(ROLES.filter((role) => canViewTechnicians({ role }))).toEqual(['SUPER_ADMIN', 'OM', 'OE', 'RO']);
    expect(ROLES.filter((role) => canAddTechnician({ role }))).toEqual(['SUPER_ADMIN', 'OM', 'OE']);

    const tech = { managerId: 'oe-1' };
    expect(canManageTechnician({ id: 'sa', role: 'SUPER_ADMIN' }, tech)).toBe(true);
    expect(canManageTechnician({ id: 'om', role: 'OM' }, tech)).toBe(true);
    expect(canManageTechnician({ id: 'oe-1', role: 'OE' }, tech)).toBe(true);
    expect(canManageTechnician({ id: 'oe-2', role: 'OE' }, tech)).toBe(false);
    expect(canManageTechnician({ id: 'ro', role: 'RO' }, tech)).toBe(false);
    expect(canManageTechnician({ id: 'ot', role: 'OT' }, { managerId: 'ot' })).toBe(false);
    expect(canManageTechnician({ role: 'OE' }, { managerId: null })).toBe(false);
  });
});

describe('master helpers', () => {
  it('maps lookup kinds to URL slugs and back', () => {
    expect(lookupKindToSlug('FINAL_ISSUE')).toBe('final-issue');
    for (const kind of LOOKUP_KINDS) expect(lookupKindFromSlug(lookupKindToSlug(kind))).toBe(kind);
    expect(lookupKindFromSlug('nope')).toBeNull();
    expect(lookupKindFromSlug('activities')).toBeNull();
  });

  it('builds case- and whitespace-insensitive keys', () => {
    expect(toNameKey('  Wiring   Issue ')).toBe('wiring issue');
    expect(toMakeModelKey(' TATA ', 'Ace  Gold')).toBe('tata|ace gold');
  });
});

describe('master schemas', () => {
  it('normalises names and rejects blanks', () => {
    expect(createLookupItemSchema.parse({ name: '  SOS   button ' })).toEqual({ name: 'SOS button' });
    expect(fieldErrors(createLookupItemSchema.safeParse({ name: '  ' }))).toEqual({ name: ['Name is required'] });
    expect(createLookupItemSchema.safeParse({ name: 'x'.repeat(101) }).success).toBe(false);
  });

  it('update schemas need at least one field', () => {
    expect(updateLookupItemSchema.safeParse({}).success).toBe(false);
    expect(updateLookupItemSchema.parse({ active: false })).toEqual({ active: false });
    expect(updateTechnicianSchema.safeParse({}).success).toBe(false);
  });

  it('structured masters require their references', () => {
    expect(fieldErrors(createActivitySchema.safeParse({ name: 'Removal' }))).toEqual({
      assetTypeId: ['Choose an asset type'],
    });
    expect(fieldErrors(createLocationSchema.safeParse({ city: '' }))).toEqual({
      city: ['City is required'],
      stateId: ['Choose a state'],
      regionId: ['Choose a region'],
    });
    expect(fieldErrors(createMakeModelSchema.safeParse({ make: 'Tata' }))).toEqual({ model: ['Model is required'] });
  });

  it('parses the active filter', () => {
    expect(masterListQuerySchema.parse({ active: 'true' })).toEqual({ active: true });
    expect(masterListQuerySchema.parse({ active: 'false', q: ' x ' })).toEqual({ active: false, q: 'x' });
    expect(masterListQuerySchema.safeParse({ active: 'yes' }).success).toBe(false);
  });
});

describe('technician schemas', () => {
  const valid = {
    name: 'Ravi',
    phone: '+91 90000 00001',
    email: ' Ravi@Intellicar.in ',
    technicianType: 'PAYROLL',
    baseLocationId: 'loc-1',
  };

  it('accepts a complete technician and normalises the email', () => {
    expect(createTechnicianSchema.parse(valid)).toMatchObject({ email: 'ravi@intellicar.in', technicianType: 'PAYROLL' });
  });

  it('requires type and base location with friendly messages', () => {
    const errors = fieldErrors(createTechnicianSchema.safeParse({ ...valid, technicianType: undefined, baseLocationId: '' }));
    expect(errors).toEqual({ technicianType: ['Choose a technician type'], baseLocationId: ['Choose a base location'] });
    expect(createTechnicianSchema.safeParse({ ...valid, technicianType: 'FREELANCE' }).success).toBe(false);
  });

  it('list query coerces pagination and validates the type', () => {
    expect(listTechniciansQuerySchema.parse({ page: '2', type: 'THIRD_PARTY' })).toMatchObject({
      page: 2,
      pageSize: 20,
      type: 'THIRD_PARTY',
    });
    expect(listTechniciansQuerySchema.safeParse({ type: 'X' }).success).toBe(false);
  });
});

describe('createInviteSchema — OT refinement', () => {
  it('an OT invite requires technician type and base location', () => {
    const result = createInviteSchema.safeParse({ email: 'a@intellicar.in', role: 'OT' });
    expect(fieldErrors(result)).toEqual({
      technicianType: ['Choose a technician type'],
      baseLocationId: ['Choose a base location'],
    });
    expect(
      createInviteSchema.safeParse({
        email: 'a@intellicar.in',
        role: 'OT',
        technicianType: 'CONTRACTUAL',
        baseLocationId: 'loc-1',
      }).success,
    ).toBe(true);
  });

  it('other roles do not need them', () => {
    for (const role of ['SUPER_ADMIN', 'OM', 'OE', 'RO'] as const) {
      expect(createInviteSchema.safeParse({ email: 'a@intellicar.in', role }).success).toBe(true);
    }
  });

  it('reports the technician fields together with other field errors', () => {
    expect(Object.keys(fieldErrors(createInviteSchema.safeParse({ email: '', role: 'OT' })))).toEqual([
      'email',
      'technicianType',
      'baseLocationId',
    ]);
  });
});
