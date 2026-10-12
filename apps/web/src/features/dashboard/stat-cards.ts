import {
  BadgeCheck,
  CircleCheckBig,
  ClipboardList,
  RotateCcw,
  SearchCheck,
  TriangleAlert,
  UserCheck,
  type LucideIcon,
} from 'lucide-react';
import type { DashboardSummaryDto, Role } from '@champ/shared';

export interface StatCard {
  key: keyof DashboardSummaryDto;
  label: string;
  hint: string;
  to: string;
  icon: LucideIcon;
  /** Highlights the card when the count is above zero (something to act on). */
  attention?: boolean;
}

const CARDS = {
  openTasks: { key: 'openTasks', label: 'Open tasks', hint: 'Not finished yet', to: '/tasks', icon: ClipboardList },
  completedTasks: { key: 'completedTasks', label: 'Completed', hint: 'Finished tasks', to: '/tasks/completed', icon: CircleCheckBig },
  awaitingApproval: {
    key: 'awaitingApproval',
    label: 'Awaiting approval',
    hint: 'OE verified, needs final approval',
    to: '/tasks/awaiting-approval',
    icon: BadgeCheck,
    attention: true,
  },
  reopened: { key: 'reopened', label: 'Re-opened', hint: 'Sent back for rework', to: '/tasks/reopened', icon: RotateCcw },
  faulty: { key: 'faulty', label: 'Faulty', hint: 'Moved to FT', to: '/tasks/faulty', icon: TriangleAlert },
  assignedToMe: { key: 'assignedToMe', label: 'My tasks', hint: 'You are the OE', to: '/tasks/assigned', icon: UserCheck },
  awaitingMyVerification: {
    key: 'awaitingMyVerification',
    label: 'To verify',
    hint: 'Submitted, waiting for you',
    to: '/tasks/assigned',
    icon: SearchCheck,
    attention: true,
  },
} satisfies Record<string, StatCard>;

/**
 * The dashboard stat cards of a role (CR-03), each linking to the list its count comes from: SA/OM see open
 * tasks, awaiting approval, re-opened, faulty and completed; OE their own tasks, what waits for their
 * verification, open tasks, re-opened and faulty; RO open and completed tasks; OT none (no task access).
 */
export function statCardsFor(role: Role): StatCard[] {
  switch (role) {
    case 'SUPER_ADMIN':
    case 'OM':
      return [CARDS.openTasks, CARDS.awaitingApproval, CARDS.reopened, CARDS.faulty, CARDS.completedTasks];
    case 'OE':
      return [CARDS.assignedToMe, CARDS.awaitingMyVerification, CARDS.openTasks, CARDS.reopened, CARDS.faulty];
    case 'RO':
      return [CARDS.openTasks, CARDS.completedTasks];
    default:
      return [];
  }
}
