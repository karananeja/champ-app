import { INVITABLE_ROLES, USER_LIST_ROLES, type Role, type UserDto } from '@champ/shared';

// Master and technician rules are shared with the API.
export {
  canAddTechnician,
  canEditClients,
  canEditLookupKind,
  canEditMasters,
  canManageTechnician,
  canViewClients,
  canViewTechnicians,
} from '@champ/shared';

export const invitableRoles = (user: UserDto): readonly Role[] => INVITABLE_ROLES[user.role];

export const canInviteAny = (user: UserDto) => invitableRoles(user).length > 0;

export const canViewUsers = (user: UserDto) => USER_LIST_ROLES.includes(user.role);

/** SA, or an OM with delegated user management. */
export const canManageUsers = (user: UserDto) =>
  user.role === 'SUPER_ADMIN' || (user.role === 'OM' && user.canManageUsers);

/** Mirrors the server rules for PATCH /users/:id. */
export function canEditUser(actor: UserDto, target: UserDto): boolean {
  if (!canManageUsers(actor) || actor.id === target.id) return false;
  if (actor.role === 'OM' && (target.role === 'SUPER_ADMIN' || target.role === 'OM')) return false;
  return true;
}

/** Roles the actor may assign when editing a user. */
export function assignableRoles(actor: UserDto): readonly Role[] {
  return actor.role === 'SUPER_ADMIN' ? ['SUPER_ADMIN', 'OM', 'OE', 'OT', 'RO'] : ['OE', 'OT', 'RO'];
}

export const canEditDelegation = (actor: UserDto, target: UserDto) =>
  actor.role === 'SUPER_ADMIN' && target.role === 'OM';
