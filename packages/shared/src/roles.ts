export const ROLES = ['SUPER_ADMIN', 'OM', 'OE', 'OT', 'RO'] as const;
export type Role = (typeof ROLES)[number];

/** Enum-like accessor, e.g. `Role.OM`. */
export const Role = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  OM: 'OM',
  OE: 'OE',
  OT: 'OT',
  RO: 'RO',
} as const satisfies Record<Role, Role>;

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: 'Super Admin',
  OM: 'Operations Manager',
  OE: 'Operations Executive',
  OT: 'Operations Technician',
  RO: 'Read Only',
};

export const ROLE_SHORT_LABELS: Record<Role, string> = {
  SUPER_ADMIN: 'SA',
  OM: 'OM',
  OE: 'OE',
  OT: 'OT',
  RO: 'RO',
};

/** Which roles each role may invite. */
export const INVITABLE_ROLES: Record<Role, readonly Role[]> = {
  SUPER_ADMIN: ['SUPER_ADMIN', 'OM', 'OE', 'OT', 'RO'],
  OM: ['OE', 'OT', 'RO'],
  OE: ['OT'],
  OT: [],
  RO: [],
};

export function canInvite(actor: Role, target: Role): boolean {
  return INVITABLE_ROLES[actor].includes(target);
}

export function isInviter(role: Role): boolean {
  return INVITABLE_ROLES[role].length > 0;
}

export interface ManagerRule {
  /** The role the manager must have, or null when the role has no manager. */
  managerRole: Role | null;
  required: boolean;
}

/** Reporting hierarchy (D-024): OT → OE → OM. RO may optionally report to an OM. */
export const MANAGER_RULES: Record<Role, ManagerRule> = {
  SUPER_ADMIN: { managerRole: null, required: false },
  OM: { managerRole: null, required: false },
  OE: { managerRole: 'OM', required: true },
  OT: { managerRole: 'OE', required: true },
  RO: { managerRole: 'OM', required: false },
};

/** Roles that can list users (`GET /users`). */
export const USER_LIST_ROLES: readonly Role[] = ['SUPER_ADMIN', 'OM', 'OE', 'RO'];

export const USER_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const AUTH_PROVIDERS = ['PASSWORD', 'GOOGLE'] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

export const INVITE_STATUSES = ['PENDING', 'USED', 'EXPIRED', 'REVOKED'] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];

/** Invite links are single use and expire after 72 hours (D-026). */
export const INVITE_TTL_HOURS = 72;
