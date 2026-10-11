import { describe, expect, it } from 'vitest';
import { ROLES, type Role } from '@champ/shared';
import { makeUser } from '@/test/fixtures';
import { navGroupsFor } from './nav';

const linksFor = (role: Role) => navGroupsFor(makeUser({ role })).flatMap((g) => g.items.map((i) => i.to));
const groupLabelsFor = (role: Role) => navGroupsFor(makeUser({ role })).map((g) => g.label).filter(Boolean);

describe('navGroupsFor', () => {
  it('shows the Masters group only to SA and OM (CR-01)', () => {
    for (const role of ROLES) {
      const visible = role === 'SUPER_ADMIN' || role === 'OM';
      expect(linksFor(role).includes('/masters'), role).toBe(visible);
      expect(groupLabelsFor(role).includes('Masters'), role).toBe(visible);
    }
  });

  it('OE and RO keep their other menu items', () => {
    expect(linksFor('OE')).toEqual(['/', '/users', '/technicians', '/clients', '/profile']);
    expect(linksFor('RO')).toEqual(['/', '/users', '/technicians', '/clients', '/profile']);
    expect(linksFor('OM')).toEqual(['/', '/users', '/technicians', '/clients', '/masters', '/profile']);
  });
});
