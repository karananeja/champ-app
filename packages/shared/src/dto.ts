import type { LookupKind, TechnicianType } from './masters';
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
  /** Technicians (OT) only. */
  technicianType: TechnicianType | null;
  /** Technicians (OT) only. */
  baseLocationId: string | null;
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
  /** Optional prefill for the accept page. */
  name: string | null;
  phone: string | null;
  /** OT invites only. */
  technicianType: TechnicianType | null;
  baseLocationId: string | null;
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
  /** Prefill values entered by the inviter (technician invites). */
  name: string | null;
  phone: string | null;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// --- Masters (F02) ---

export interface LookupItemDto {
  id: string;
  kind: LookupKind;
  name: string;
  code: string | null;
  isSystem: boolean;
  active: boolean;
  /** FINAL_ISSUE only. */
  billable: boolean | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityDto {
  id: string;
  name: string;
  assetTypeId: string;
  assetType: UserRef;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MakeModelDto {
  id: string;
  make: string;
  model: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LocationDto {
  id: string;
  city: string;
  stateId: string;
  regionId: string;
  state: UserRef;
  region: UserRef;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Admin list responses for masters. */
export interface ListResponse<T> {
  items: T[];
}

/** An active option in `GET /lookups`. */
export interface LookupOption {
  id: string;
  name: string;
  code: string | null;
}

export interface LookupsResponse {
  assetTypes: LookupOption[];
  activities: (LookupOption & { assetTypeId: string })[];
  deviceTypes: LookupOption[];
  makeModels: { id: string; make: string; model: string }[];
  installationTypes: LookupOption[];
  states: LookupOption[];
  regions: LookupOption[];
  locations: { id: string; city: string; stateId: string; stateName: string; regionId: string; regionName: string }[];
  issuesReported: LookupOption[];
  issuesObserved: LookupOption[];
  actionsTaken: LookupOption[];
  finalIssues: (LookupOption & { billable: boolean })[];
  accessories: LookupOption[];
  closeReasons: LookupOption[];
  shiftTypes: LookupOption[];
  taskTypes: LookupOption[];
  technicianTypes: { value: TechnicianType; label: string }[];
}

// --- Technicians (F02) ---

export interface TechnicianDto extends UserDto {
  baseLocation: { id: string; city: string; state: string } | null;
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
  'DUPLICATE',
  'SYSTEM_ITEM',
  'INVALID_REFERENCE',
  'INACTIVE_REFERENCE',
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
