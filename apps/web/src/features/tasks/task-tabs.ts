import type { UserDto } from '@champ/shared';
import { canApproveFitments, canUseBoard } from '@/lib/permissions';

export interface TaskTab {
  to: string;
  label: string;
}

/**
 * CR-10: the task views shown as tabs on the Tasks page, each at its own URL; the Board first (where the Tasks menu
 * item opens for SA/OM). Same per-role rules the menu had:
 * Assigned for OEs, Awaiting approval for approvers (SA/OM), the Board (F07) for SA/OM; the rest for every task viewer.
 */
export function taskTabsFor(user: UserDto): TaskTab[] {
  return [
    ...(canUseBoard(user) ? [{ to: '/tasks/board', label: 'Board' }] : []),
    { to: '/tasks', label: 'Open' },
    ...(user.role === 'OE' ? [{ to: '/tasks/assigned', label: 'Assigned' }] : []),
    ...(canApproveFitments(user) ? [{ to: '/tasks/awaiting-approval', label: 'Awaiting approval' }] : []),
    { to: '/tasks/reopened', label: 'Re-opened' },
    { to: '/tasks/faulty', label: 'Faulty' },
    { to: '/tasks/completed', label: 'Completed' },
    { to: '/tasks/all', label: 'All' },
    { to: '/tasks/travel', label: 'Travel' },
  ];
}
