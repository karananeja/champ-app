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
    expect(linksFor('OE').filter((l) => !l.startsWith('/tasks'))).toEqual([...top, '/profile']);
    expect(linksFor('RO').filter((l) => !l.startsWith('/tasks'))).toEqual([...top, '/profile']);
    expect(linksFor('OM').filter((l) => !l.startsWith('/tasks'))).toEqual([...top, '/masters', '/profile']);
  });

  it('Tasks group (F04/F05, CR-04 Completed/All for every viewer): creators get Create/Bulk upload, only OEs get Assigned, SA/OM get Awaiting approval, OT gets nothing', () => {
    const views = ['/tasks/completed', '/tasks/all', '/tasks/travel', '/tasks/faulty', '/tasks/reopened'];
    const tasksOf = (role: Role) => linksFor(role).filter((l) => l.startsWith('/tasks'));
    expect(tasksOf('SUPER_ADMIN')).toEqual(['/tasks/new', '/tasks/bulk', '/tasks', '/tasks/awaiting-approval', ...views]);
    expect(tasksOf('OM')).toEqual(['/tasks/new', '/tasks/bulk', '/tasks', '/tasks/awaiting-approval', ...views]);
    expect(tasksOf('OE')).toEqual(['/tasks/new', '/tasks/bulk', '/tasks', '/tasks/assigned', ...views]);
    expect(tasksOf('RO')).toEqual(['/tasks', ...views]);
    expect(tasksOf('OT')).toEqual([]);
    expect(groupLabelsFor('OT')).not.toContain('Tasks');
    expect(groupLabelsFor('RO')).toContain('Tasks');
  });
});
