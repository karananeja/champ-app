import {
  BadgeCheck,
  Building2,
  CircleCheckBig,
  ClipboardList,
  Database,
  FilePlus2,
  HardHat,
  LayoutDashboard,
  ListTodo,
  RotateCcw,
  Route,
  TriangleAlert,
  Upload,
  UserCheck,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { UserDto } from '@champ/shared';
import { canApproveFitments, canCreateTask, canViewClients, canViewMasters, canViewTasks, canViewTechnicians, canViewUsers } from '@/lib/permissions';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Active only on this exact path (not on child paths). */
  end?: boolean;
}

/**
 * The Tasks group (F04/F05): creators get Create/Bulk upload, OEs get Assigned, SA/OM get Awaiting approval;
 * Completed tasks, All tasks (CR-04), Faulty and Re-opened for every task viewer; Travel is a placeholder (F08).
 */
function taskItems(user: UserDto): NavItem[] {
  const creator = canCreateTask(user);
  return [
    ...(creator ? [{ to: '/tasks/new', label: 'Create task', icon: FilePlus2 }] : []),
    ...(creator ? [{ to: '/tasks/bulk', label: 'Bulk upload', icon: Upload }] : []),
    { to: '/tasks', label: 'Open tasks', icon: ClipboardList, end: true },
    ...(user.role === 'OE' ? [{ to: '/tasks/assigned', label: 'Assigned', icon: UserCheck }] : []),
    ...(canApproveFitments(user) ? [{ to: '/tasks/awaiting-approval', label: 'Awaiting approval', icon: BadgeCheck }] : []),
    { to: '/tasks/completed', label: 'Completed tasks', icon: CircleCheckBig },
    { to: '/tasks/all', label: 'All tasks', icon: ListTodo },
    { to: '/tasks/travel', label: 'Travel tasks', icon: Route },
    { to: '/tasks/faulty', label: 'Faulty tasks', icon: TriangleAlert },
    { to: '/tasks/reopened', label: 'Re-opened', icon: RotateCcw },
  ];
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
    ...(canViewTasks(user) ? [{ label: 'Tasks', items: taskItems(user) }] : []),
    // Masters admin: SA and OM only (D-059).
    ...(canViewMasters(user) ? [{ label: 'Masters', items: [{ to: '/masters', label: 'All masters', icon: Database }] }] : []),
    { items: [{ to: '/profile', label: 'Profile', icon: UserRound }] },
  ];
}
