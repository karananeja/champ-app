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
  /** Active clients with their active sites (F03); consumed by the task form (F04). */
  clients: LookupClient[];
}

export interface LookupClient {
  id: string;
  name: string;
  code: string | null;
  sites: { id: string; name: string; locationId: string; lat: number; lng: number }[];
}

// --- Technicians (F02) ---

export interface TechnicianDto extends UserDto {
  baseLocation: { id: string; city: string; state: string } | null;
}

// --- Clients and geocoding (F03) ---

export interface ClientSiteDto {
  id: string;
  clientId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  locationId: string;
  location: { id: string; city: string; state: string; active: boolean };
  contactName: string | null;
  contactPhone: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A row of `GET /clients`. */
export interface ClientListItemDto {
  id: string;
  name: string;
  code: string | null;
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  billingEmail: string | null;
  active: boolean;
  siteCount: number;
  activeSiteCount: number;
  createdAt: string;
  updatedAt: string;
}

/** `GET /clients/:id`: the client with all of its sites (active and inactive). */
export interface ClientDto extends ClientListItemDto {
  notes: string | null;
  createdBy: UserRef;
  sites: ClientSiteDto[];
}

/** A geocoder hit (search or reverse). */
export interface GeoResult {
  displayName: string;
  lat: number;
  lng: number;
  city?: string;
  state?: string;
  postcode?: string;
}

/** A geocoder hit with the matching active Location (city master), when there is one. */
export interface GeoResultDto extends GeoResult {
  suggestedLocationId?: string;
}

export interface GeoSearchResponse {
  items: GeoResultDto[];
}

export interface GeoReverseResponse {
  item: GeoResultDto | null;
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
  'LAST_ACTIVE_SITE',
  'GEOCODER_UNAVAILABLE',
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
