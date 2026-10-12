import {
  Building2,
  ChartColumn,
  ClipboardList,
  Database,
  HardHat,
  LayoutDashboard,
  ReceiptIndianRupee,
  Search,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { UserDto } from '@champ/shared';
import {
  canManageSearchSettings,
  canUseBoard,
  canViewAnalytics,
  canViewBilling,
  canViewClients,
  canViewMasters,
  canViewTasks,
  canViewTechnicians,
  canViewUsers,
} from '@/lib/permissions';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Active only on this exact path (not on child paths). */
  end?: boolean;
  /** Also active on these paths and their child paths (CR-10: Tasks stays active on every task route and Search). */
  alsoActiveOn?: string[];
}

export interface NavGroup {
  /** Group heading; omitted for the top group. */
  label?: string;
  items: NavItem[];
}

/** Role-aware menu, in groups. */
export function navGroupsFor(user: UserDto): NavGroup[] {
  return [
    {
      items: [
        { to: '/', label: 'Dashboard', icon: LayoutDashboard },
        ...(canViewUsers(user) ? [{ to: '/users', label: 'Users', icon: Users }] : []),
        ...(canViewTechnicians(user) ? [{ to: '/technicians', label: 'Technicians', icon: HardHat }] : []),
        ...(canViewClients(user) ? [{ to: '/clients', label: 'Clients', icon: Building2 }] : []),
      ],
    },
    // CR-10: one Tasks item; the task views are tabs on the Tasks page (task-tabs.ts). It opens the Board for SA/OM
    // and the Open tab for others, and is active on every /tasks route (lists, new, bulk, detail) and on Search.
    ...(canViewTasks(user)
      ? [{ items: [{ to: canUseBoard(user) ? '/tasks/board' : '/tasks', label: 'Tasks', icon: ClipboardList, alsoActiveOn: ['/tasks', '/search'] }] }]
      : []),
    // F15 (D-267): Reports after Tasks; Billing for SA/OM/RO, Analytics also for OE.
    ...(canViewBilling(user) || canViewAnalytics(user)
      ? [
          {
            label: 'Reports',
            items: [
              ...(canViewBilling(user) ? [{ to: '/reports/billing', label: 'Billing', icon: ReceiptIndianRupee }] : []),
              ...(canViewAnalytics(user) ? [{ to: '/reports/analytics', label: 'Analytics', icon: ChartColumn }] : []),
            ],
          },
        ]
      : []),
    // Masters admin: SA and OM only (D-059).
    ...(canViewMasters(user) ? [{ label: 'Masters', items: [{ to: '/masters', label: 'All masters', icon: Database }] }] : []),
    // F14: SA only.
    ...(canManageSearchSettings(user) ? [{ label: 'Settings', items: [{ to: '/settings/search', label: 'Search identifiers', icon: Search }] }] : []),
    { items: [{ to: '/profile', label: 'Profile', icon: UserRound }] },
  ];
}
