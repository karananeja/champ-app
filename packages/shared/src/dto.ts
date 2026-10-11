import type { AuthProvider, InviteStatus, Role, UserStatus } from './roles';

export interface UserRef {
  id: string;
  name: string;
}

export interface ManagerRef extends UserRef {
  phone: string | null;
}

export interface UserDto {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  jobTitle: string | null;
  role: Role;
  status: UserStatus;
  authProvider: AuthProvider;
  managerId: string | null;
  manager: ManagerRef | null;
  canManageUsers: boolean;
  canManageTaskTypes: boolean;
  createdAt: string;
}

export interface AuthResponse {
  accessToken: string;
  user: UserDto;
}

export interface ConfigResponse {
  googleClientId: string | null;
}

export interface HealthResponse {
  ok: boolean;
  db: 'up' | 'down';
}

export interface InviteDto {
  id: string;
  email: string;
  role: Role;
  jobTitle: string | null;
  status: InviteStatus;
  manager: UserRef | null;
  invitedBy: UserRef;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface CreateInviteResponse {
  invite: InviteDto;
  /** One-time link; only ever returned in this response. */
  link: string;
}

export interface InviteLookupResponse {
  email: string;
  role: Role;
  inviterName: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'INVALID_CREDENTIALS',
  'ACCOUNT_INACTIVE',
  'RATE_LIMITED',
  'REFRESH_INVALID',
  'REFRESH_REUSED',
  'GOOGLE_NOT_CONFIGURED',
  'GOOGLE_TOKEN_INVALID',
  'GOOGLE_DOMAIN_NOT_ALLOWED',
  'GOOGLE_USER_NOT_FOUND',
  'GOOGLE_EMAIL_MISMATCH',
  'ROLE_NOT_INVITABLE',
  'EMAIL_EXISTS',
  'MANAGER_REQUIRED',
  'MANAGER_INVALID',
  'MANAGER_NOT_ALLOWED',
  'INVITE_EXPIRED',
  'INVITE_USED',
  'INVITE_INVALID',
  'INVITE_NOT_PENDING',
  'CANNOT_MODIFY_SELF',
  'HAS_REPORTEES',
  'TARGET_NOT_OM',
  'INTERNAL_ERROR',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}
