import { LayoutDashboard, UserRound, Users, type LucideIcon } from 'lucide-react';
import type { UserDto } from '@champ/shared';
import { canViewUsers } from '@/lib/permissions';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

/** Role-aware menu items. */
export function navItemsFor(user: UserDto): NavItem[] {
  return [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard },
    ...(canViewUsers(user) ? [{ to: '/users', label: 'Users', icon: Users }] : []),
    { to: '/profile', label: 'Profile', icon: UserRound },
  ];
}
