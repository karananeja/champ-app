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
    const top = ['/', '/users', '/technicians', '/clients'];
    expect(linksFor('OE').filter((l) => !l.startsWith('/tasks'))).toEqual([...top, '/reports/analytics', '/profile']);
    expect(linksFor('RO').filter((l) => !l.startsWith('/tasks'))).toEqual([...top, '/reports/billing', '/reports/analytics', '/profile']);
    expect(linksFor('OM').filter((l) => !l.startsWith('/tasks'))).toEqual([...top, '/reports/billing', '/reports/analytics', '/masters', '/profile']);
  });

  it('one Tasks item for task viewers (CR-10: the views are tabs), opening the Board for SA/OM; none for OT; Settings for SA only', () => {
    const tasksOf = (role: Role) => linksFor(role).filter((l) => l.startsWith('/tasks'));
    for (const role of ['SUPER_ADMIN', 'OM', 'OE', 'RO'] as const) {
      expect(tasksOf(role), role).toEqual([role === 'SUPER_ADMIN' || role === 'OM' ? '/tasks/board' : '/tasks']);
      const item = navGroupsFor(makeUser({ role })).flatMap((g) => g.items).find((i) => i.label === 'Tasks');
      expect(item?.label).toBe('Tasks');
      expect(item?.alsoActiveOn).toEqual(['/tasks', '/search']);
    }
    expect(tasksOf('OT')).toEqual([]);
    for (const role of ROLES) {
      expect(linksFor(role).includes('/settings/search'), role).toBe(role === 'SUPER_ADMIN');
    }
  });
});
