import { describe, expect, it } from 'vitest';
import { INVITABLE_ROLES, MANAGER_RULES, ROLES, canInvite, isInviter, type Role } from '../src';

const expected: Record<Role, Role[]> = {
  SUPER_ADMIN: ['SUPER_ADMIN', 'OM', 'OE', 'OT', 'RO'],
  OM: ['OE', 'OT', 'RO'],
  OE: ['OT'],
  OT: [],
  RO: [],
};

describe('INVITABLE_ROLES matrix', () => {
  for (const actor of ROLES) {
    for (const target of ROLES) {
      const allowed = expected[actor].includes(target);
      it(`${actor} ${allowed ? 'can' : 'cannot'} invite ${target}`, () => {
        expect(canInvite(actor, target)).toBe(allowed);
      });
    }
  }

  it('matches the spec exactly', () => {
    expect(INVITABLE_ROLES).toEqual(expected);
  });

  it('only SA, OM and OE are inviters', () => {
    expect(ROLES.filter(isInviter)).toEqual(['SUPER_ADMIN', 'OM', 'OE']);
  });
});

describe('MANAGER_RULES', () => {
  it('OT reports to an OE and OE reports to an OM', () => {
    expect(MANAGER_RULES.OT).toEqual({ managerRole: 'OE', required: true });
    expect(MANAGER_RULES.OE).toEqual({ managerRole: 'OM', required: true });
  });

  it('SA and OM have no manager; RO manager is optional', () => {
    expect(MANAGER_RULES.SUPER_ADMIN.managerRole).toBeNull();
    expect(MANAGER_RULES.OM.managerRole).toBeNull();
    expect(MANAGER_RULES.RO.required).toBe(false);
  });
});
