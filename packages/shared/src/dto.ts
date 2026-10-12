import type { LookupKind, TechnicianType } from './masters';
import type { AuthProvider, InviteStatus, Role, UserStatus } from './roles';
import type { BulkTaskColumn, FitmentStatus, TaskStatus } from './tasks';
import type { PhotoKind, PhotoSource, PhotoStatus } from './verification';
import type { FitmentFormDto } from './fitment-form';
import type { FitmentAction, TaskEventType } from './workflow';
import type { HomeLocationDto } from './mobile';
import type { TravelAction, TravelAttachmentStatus, TravelEventType, TravelSource, TravelStatus } from './travel';

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
  /** OT and OE only (D-129); null when not set or for other roles. */
  homeLocation: HomeLocationDto | null;
  createdAt: string;
}

export interface AuthResponse {
  accessToken: string;
  user: UserDto;
}

export interface ConfigResponse {
  googleClientId: string | null;
  /** Whether the dev-only technician simulator API is mounted (D-073; never in production). */
  devSimulator: boolean;
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
  /** Primary contact, prefilled as the task POC (F04). */
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
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

// --- Tasks (F04) ---

/** A master value referenced by a task, with its active flag (inactive values show as "(inactive)"). */
export interface TaskRef {
  id: string;
  name: string;
  code: string | null;
  active: boolean;
}

export interface TaskTechnicianRef {
  id: string;
  name: string;
  technicianType: TechnicianType | null;
}

export interface FitmentCounts {
  total: number;
  assigned: number;
  open: number;
}

/** A row of `GET /tasks`. */
export interface TaskListItemDto {
  id: string;
  /** `OM-00001` */
  omId: string;
  /** `OE-00001` (the OE task id; `oe` is the operation executive). */
  oeTaskId: string;
  status: TaskStatus;
  client: { id: string; name: string; code: string | null };
  site: { id: string; name: string };
  city: string;
  assetType: { id: string; name: string };
  activity: { id: string; name: string };
  oe: UserRef;
  fitments: FitmentCounts;
  fitmentAt: string;
  createdAt: string;
  /** When the task last became Completed (CR-04); null while it isn't. */
  completedAt: string | null;
  /** F06: fitments currently verified (OE verified or OM approved) and, of those, billable ("3 / 5"). */
  verifiedCount: number;
  billableCount: number;
}

/** The OE verification of a fitment (F06), names resolved; inactive values keep `active: false`. */
export interface FitmentVerificationDto {
  issueObserved: TaskRef | null;
  actionTaken: TaskRef | null;
  accessories: TaskRef[];
  oeRemarks: string | null;
  /** Entered by the technician on submit (F10, or the dev simulator). */
  otRemarks: string | null;
  /** The final issue with its current master flag (what a change would snapshot). */
  finalIssue: (TaskRef & { billable: boolean }) | null;
  /** Snapshot taken at verification (D-101); null until verified. */
  billable: boolean | null;
  updatedAt: string | null;
  updatedBy: UserRef | null;
}

export interface PhotoCounts {
  active: number;
  byKind: Partial<Record<PhotoKind, number>>;
}

export interface FitmentDto {
  id: string;
  /** `TK-00001` */
  tkId: string;
  seq: number;
  status: FitmentStatus;
  technician: TaskTechnicianRef | null;
  vehicleRegNo: string | null;
  chassisNo: string | null;
  assetNumber: string | null;
  oldDeviceId: string | null;
  // --- Workflow (F05) ---
  /** What the caller may do with this fitment now (shared `availableActions`). */
  availableActions: FitmentAction[];
  /** Whether the caller may change the fitment data (shared `canEditFitmentData`). */
  canEditData: boolean;
  startedAt: string | null;
  startLat: number | null;
  startLng: number | null;
  submittedAt: string | null;
  verifiedAt: string | null;
  verifiedBy: UserRef | null;
  approvedAt: string | null;
  approvedBy: UserRef | null;
  closedAt: string | null;
  closeReason: { id: string; name: string } | null;
  closeComments: string | null;
  faultyAt: string | null;
  faultReason: string | null;
  /** On a replacement: the faulty fitment it replaces. */
  replacementOf: { id: string; tkId: string } | null;
  /** On a fitment moved to FT: its replacement. */
  replacement: { id: string; tkId: string; status: FitmentStatus } | null;
  reopenCount: number;
  lastReopenReason: string | null;
  lastReopenedAt: string | null;
  // --- Verification and photos (F06) ---
  verification: FitmentVerificationDto;
  photoCounts: PhotoCounts;
  /** Whether the caller may save the verification (shared `canEditVerification`). */
  canEditVerification: boolean;
  /** Whether the caller may replace or remove photos and upload debug images (shared `canManagePhotos`). */
  canManagePhotos: boolean;
  // --- Technician form (F10B) ---
  /** The technician's answers (checks, readings, device replacement, device ids, comments). */
  technicianForm: FitmentFormDto;
}

/** `GET /tasks/:id`: the task with resolved names, its fitments and what the caller may do. */
export interface TaskDto {
  id: string;
  omId: string;
  oeTaskId: string;
  status: TaskStatus;
  taskType: TaskRef;
  client: TaskRef;
  site: { id: string; name: string; address: string; lat: number; lng: number; active: boolean };
  location: { id: string; city: string; state: string };
  pocName: string;
  pocPhone: string;
  pocEmail: string | null;
  oeId: string;
  oe: UserRef & { active: boolean };
  technicianType: TechnicianType | null;
  assetType: TaskRef;
  activity: TaskRef;
  deviceType: TaskRef;
  makeModel: { id: string; make: string; model: string; active: boolean } | null;
  installationType: TaskRef;
  requestedAt: string;
  fitmentAt: string;
  shiftType: TaskRef;
  issueReported: TaskRef;
  gpsAddress: string | null;
  comments: string | null;
  vehicleEntry: 'COUNT' | 'CSV';
  counts: FitmentCounts;
  fitments: FitmentDto[];
  createdBy: UserRef;
  createdAt: string;
  updatedAt: string;
  /** When the task last became Completed (CR-04); null while it isn't. */
  completedAt: string | null;
  /** Whether the caller may edit, assign or delete (spec §3, untouched rule), and see the History tab (F05). */
  permissions: { canEdit: boolean; canAssign: boolean; canDelete: boolean; canViewHistory: boolean };
}

/** `GET /tasks/options`: people the task form and filters offer. */
export interface TaskOptionsResponse {
  /** Active OEs (an OE gets only themselves). */
  oes: UserRef[];
  /** Active technicians (OT). */
  technicians: (TaskTechnicianRef & { baseLocation: string | null })[];
  /** F10 (D-158): active OEs the caller may assign fitments to (SA/OM: all; OE: themselves; RO: none). */
  assignableOes: UserRef[];
}

export interface BulkCellError<C extends string = BulkTaskColumn> {
  /** A bulk CSV column, or '' for a row-level error. */
  column: C | '';
  message: string;
}

export interface BulkPreviewRow {
  /** Line number in the file (the header is line 1). */
  rowNumber: number;
  data: Record<string, string>;
  errors: BulkCellError[];
  valid: boolean;
}

export interface BulkPreviewResponse {
  rows: BulkPreviewRow[];
  validCount: number;
  invalidCount: number;
}

export interface BulkImportResponse {
  created: { rowNumber: number; id: string; omId: string }[];
  failed: { rowNumber: number; errors: BulkCellError[] }[];
}

// --- Workflow (F05) ---

/** The task part of a transition response. */
export interface TaskSummaryDto {
  id: string;
  omId: string;
  status: TaskStatus;
  counts: FitmentCounts;
}

/** `POST /fitments/:fid/transitions` and `POST /dev/fitments/:fid/simulate`. */
export interface TransitionResponse {
  fitment: FitmentDto;
  task: TaskSummaryDto;
}

/** `POST /fitments/approve`: per-fitment results (each fitment is approved in its own transaction). */
export interface ApproveFitmentsResponse {
  approved: string[];
  failed: { tkId: string; code: string; message: string }[];
}

/** A row of the Awaiting approval, Re-opened and Faulty lists. */
export interface WorkflowFitmentItemDto {
  id: string;
  tkId: string;
  status: FitmentStatus;
  task: { id: string; omId: string };
  client: { id: string; name: string };
  site: { id: string; name: string };
  technician: UserRef | null;
  oe: UserRef;
  vehicleRegNo: string | null;
  verifiedAt: string | null;
  verifiedBy: UserRef | null;
  reopenCount: number;
  lastReopenReason: string | null;
  lastReopenedAt: string | null;
  lastReopenedBy: UserRef | null;
  faultReason: string | null;
  faultyAt: string | null;
  replacement: { id: string; tkId: string; status: FitmentStatus; technician: UserRef | null } | null;
  /** What the caller may do with this fitment now (CR-11: UNDO_FAULTY on a Faulty row whose replacement isn't started). */
  availableActions: FitmentAction[];
  /** CR-11 (D-256): the caller may assign the replacement (it is Open or Assigned and the caller can assign on this task). */
  canAssignReplacement: boolean;
}

/** One stage of a timeline: when it started and who did it; `completedAt`/`completedBy` when it finished. */
export interface StageStep {
  at: string;
  by: UserRef | null;
  completedAt: string | null;
  completedBy: UserRef | null;
}

/** First (Open/Assigned) → Second (In progress/Submitted) → Verification (OE verified) → Final (OM approved). */
export interface StageTimeline {
  first: StageStep | null;
  second: StageStep | null;
  verification: StageStep | null;
  final: StageStep | null;
}

export interface ReopenLoopDto {
  at: string;
  by: UserRef;
  fromStatus: FitmentStatus;
  reason: string;
  attributions: { user: UserRef; role: Role }[];
}

/** `GET /tasks/:id/history` (SA/OM, D-033). */
export interface TaskHistoryResponse {
  task: StageTimeline;
  fitments: {
    id: string;
    tkId: string;
    status: FitmentStatus;
    technician: UserRef | null;
    stages: StageTimeline;
    reopenLoops: ReopenLoopDto[];
  }[];
}

/** A row of `GET /tasks/:id/events` (the raw data). `data` is the diff `{ field: [before, after] }` or a payload. */
export interface TaskEventDto {
  id: string;
  at: string;
  actor: UserRef;
  fitment: { id: string; tkId: string } | null;
  type: TaskEventType;
  fromStatus: string | null;
  toStatus: string | null;
  data: unknown;
}

// --- Photos (F06) ---

/** A photo of a fitment; `url` is a short-lived presigned GET URL (10 minutes). */
export interface FitmentPhotoDto {
  id: string;
  fitmentId: string;
  kind: PhotoKind;
  status: PhotoStatus;
  url: string;
  contentType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  originalName: string | null;
  takenAt: string | null;
  lat: number | null;
  lng: number | null;
  source: PhotoSource;
  uploadedBy: UserRef;
  createdAt: string;
  /** On a replaced photo: the photo that replaced it. */
  replacedById: string | null;
  /** Why it was replaced or removed, by whom and when. */
  changeReason: string | null;
  changedBy: UserRef | null;
  changedAt: string | null;
}

/** `GET /fitments/:fid/photos`. */
export interface FitmentPhotosResponse {
  items: FitmentPhotoDto[];
  /** Whether the caller may ask for `?history=true`. */
  canViewHistory: boolean;
  /** Whether the caller may replace, remove and upload now. */
  canManage: boolean;
}

/** `POST /fitments/:fid/photos` and `…/replace`: the new photo. */
export interface PhotoUploadResponse {
  photo: FitmentPhotoDto;
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
  'TASK_STARTED',
  'FITMENT_LOCKED',
  'TRAVEL_LOCKED',
  'INVALID_TRANSITION',
  'VERIFICATION_INCOMPLETE',
  'FILE_TOO_LARGE',
  'UNSUPPORTED_FILE',
  'STORAGE_UNAVAILABLE',
  'MOBILE_ROLE_NOT_ALLOWED',
  'ROUTE_ORDER',
  'FORM_INCOMPLETE',
  'GPS_REQUIRED',
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

/**
 * `GET /tasks/summary` (CR-03 dashboard): role-aware counts, each equal to the total of the list its card links
 * to. Only the counts for the caller's role are present.
 */
export interface DashboardSummaryDto {
  /** Open tasks (not completed): every task viewer. */
  openTasks: number;
  /** Completed tasks: every task viewer. */
  completedTasks: number;
  /** SA/OM: fitments awaiting final approval. */
  awaitingApproval?: number;
  /** SA/OM/OE (OE: own tasks): fitments reopened at least once (the Re-opened list). */
  reopened?: number;
  /** SA/OM/OE (OE: own tasks): fitments moved to FT (the Faulty list). */
  faulty?: number;
  /** OE: tasks where the caller is the OE (the Assigned list). */
  assignedToMe?: number;
  /** OE: fitments of the caller's tasks that are submitted and wait for the OE's verification. */
  awaitingMyVerification?: number;
  /** F08 — OM: every Raised travel task; OE: Raised travel tasks of their technicians. */
  travelToVerify?: number;
}

// --- Board (F07) ---

/** A card of the OM board: one fitment (D-109). */
export interface BoardCard {
  id: string;
  /** `TK-00001` */
  tkId: string;
  status: FitmentStatus;
  task: { id: string; omId: string; oeTaskId: string };
  client: { id: string; name: string };
  /** The site's city (the task's location, D-061). */
  city: string;
  activity: { id: string; name: string };
  technician: UserRef | null;
  /** The task's fitment date (UTC ISO; shown in IST). */
  fitmentAt: string;
  reopenCount: number;
  /** Snapshot taken at verification (D-101); null until verified. */
  billable: boolean | null;
  replacementOf: { id: string; tkId: string } | null;
  updatedAt: string;
}

/** One column of the board (`GET /board/:status`, and each entry of `GET /board`). */
export interface BoardColumnDto {
  /** Every card of the column under the filters (not just this page). */
  count: number;
  items: BoardCard[];
  hasMore: boolean;
}

/** `GET /board`: the first page of every column (all 9 statuses). */
export interface BoardResponse {
  columns: Record<FitmentStatus, BoardColumnDto>;
}

// --- Travel tasks (F08) ---

/** `GET /travel-tasks/options`: technicians the caller may raise a TT for. */
export interface TravelOptionsResponse {
  technicians: { id: string; name: string; technicianType: TechnicianType | null; baseLocation: string | null }[];
}

/** A row of `GET /fitments/lookup` (the related-task combobox). */
export interface FitmentLookupItemDto {
  id: string;
  /** `TK-00001` */
  tkId: string;
  /** `OM-00001` */
  omId: string;
  client: string;
  status: FitmentStatus;
  technician: string | null;
}

/** A row of `GET /travel-tasks`. */
export interface TravelTaskListItemDto {
  id: string;
  /** `TT-00001` */
  ttId: string;
  status: TravelStatus;
  source: TravelSource;
  /** IST calendar day, `YYYY-MM-DD`. */
  travelDate: string;
  technician: TaskTechnicianRef;
  /** The technician's reporting OE (now). */
  oe: UserRef | null;
  location: { id: string; city: string };
  client: { id: string; name: string } | null;
  purpose: string;
  distanceKm: number | null;
  relatedFitment: { id: string; tkId: string } | null;
  attachmentCount: number;
  raisedBy: UserRef;
  createdAt: string;
}

/** A receipt of a TT; `url` is a presigned GET URL (10 minutes), for images and PDFs alike. */
export interface TravelAttachmentDto {
  id: string;
  status: TravelAttachmentStatus;
  url: string;
  contentType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  originalName: string | null;
  uploadedBy: UserRef;
  createdAt: string;
}

/** A history row. `data` holds a diff `{ field: [before, after] }` (readable names), a reason or attachment details. */
export interface TravelEventDto {
  id: string;
  at: string;
  actor: UserRef;
  type: TravelEventType;
  fromStatus: TravelStatus | null;
  toStatus: TravelStatus | null;
  data: unknown;
}

/** `GET /travel-tasks/:id`: the full record, active receipts, history and what the caller may do. */
export interface TravelTaskDto extends Omit<TravelTaskListItemDto, 'relatedFitment' | 'location' | 'client'> {
  location: { id: string; city: string; active: boolean };
  client: { id: string; name: string; active: boolean } | null;
  relatedFitment: { id: string; tkId: string; taskId: string; omId: string; client: string } | null;
  verifiedAt: string | null;
  verifiedBy: UserRef | null;
  rejectedAt: string | null;
  rejectedBy: UserRef | null;
  rejectionReason: string | null;
  reopenedAt: string | null;
  reopenedBy: UserRef | null;
  reopenReason: string | null;
  updatedAt: string;
  attachments: TravelAttachmentDto[];
  events: TravelEventDto[];
  canEdit: boolean;
  canVerify: boolean;
  canManageAttachments: boolean;
  availableActions: TravelAction[];
}

/** `POST /travel-tasks/:id/attachments`. */
export interface TravelAttachmentUploadResponse {
  attachment: TravelAttachmentDto;
}
