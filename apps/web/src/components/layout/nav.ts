import { Building2, Database, HardHat, LayoutDashboard, UserRound, Users, type LucideIcon } from 'lucide-react';
import type { UserDto } from '@champ/shared';
import { canViewClients, canViewMasters, canViewTechnicians, canViewUsers } from '@/lib/permissions';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
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
    // Masters admin: SA and OM only (D-059).
    ...(canViewMasters(user) ? [{ label: 'Masters', items: [{ to: '/masters', label: 'All masters', icon: Database }] }] : []),
    { items: [{ to: '/profile', label: 'Profile', icon: UserRound }] },
  ];
}
