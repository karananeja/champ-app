import { describe, expect, it } from 'vitest';
import type { Role } from '@champ/shared';
import { makeUser } from '@/test/fixtures';
import { taskTabsFor } from './task-tabs';

const labelsFor = (role: Role) => taskTabsFor(makeUser({ role })).map((t) => t.label);

describe('taskTabsFor (CR-10)', () => {
  it('shows the task views per role, in order: Assigned for OEs, Awaiting approval and Board for SA/OM', () => {
    const shared = ['Re-opened', 'Faulty', 'Completed', 'All', 'Travel'];
    expect(labelsFor('SUPER_ADMIN')).toEqual(['Open', 'Awaiting approval', ...shared, 'Board']);
    expect(labelsFor('OM')).toEqual(['Open', 'Awaiting approval', ...shared, 'Board']);
    expect(labelsFor('OE')).toEqual(['Open', 'Assigned', ...shared]);
    expect(labelsFor('RO')).toEqual(['Open', ...shared]);
  });

  it('keeps every view at its existing URL', () => {
    expect(taskTabsFor(makeUser({ role: 'OM' })).map((t) => t.to)).toEqual([
      '/tasks',
      '/tasks/awaiting-approval',
      '/tasks/reopened',
      '/tasks/faulty',
      '/tasks/completed',
      '/tasks/all',
      '/tasks/travel',
      '/tasks/board',
    ]);
  });
});
