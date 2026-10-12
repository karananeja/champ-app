import { FITMENT_STATUS_LABELS, type FitmentStatus } from './tasks';
import type { Role } from './roles';
import type { WorkflowActor, WorkflowContext } from './workflow';

/**
 * OE verification and photos (F06): which fields verifying needs (D-098), who may edit the verification and
 * manage photos and when (the F05 edit locks, D-077), and the photo kinds. The API and the web both use it.
 */

// --- Verification fields ---

/** Fields that must be filled before a fitment can be verified (D-098). */
export const VERIFICATION_REQUIRED = ['issueObservedId', 'actionTakenId', 'finalIssueId'] as const;
export type VerificationRequiredField = (typeof VERIFICATION_REQUIRED)[number];

/** Form labels of the verification fields (also used in the VERIFICATION_INCOMPLETE details). */
export const VERIFICATION_FIELD_LABELS = {
  issueObservedId: 'Issue observed at site',
  actionTakenId: 'Action taken',
  accessoryIds: 'Accessories',
  oeRemarks: 'Remarks from OE',
  finalIssueId: 'Final issue',
} as const;

/** The required fields that are still empty, in form order. */
export function missingVerificationFields(
  v: Partial<Record<VerificationRequiredField, string | null | undefined>>,
): VerificationRequiredField[] {
  return VERIFICATION_REQUIRED.filter((field) => !v[field]);
}

/** "Choose the issue observed at site" etc.: the message shown next to an empty required field. */
export const verificationFieldMessage = (field: VerificationRequiredField): string =>
  `Choose the ${VERIFICATION_FIELD_LABELS[field].toLowerCase()}`;

// --- Edit locks ---

const isOm = (actor: WorkflowActor) => actor.role === 'OM';
const isTaskOe = (actor: WorkflowActor, ctx: WorkflowContext) => actor.role === 'OE' && ctx.task.oeId === actor.id;

/** Statuses in which the task's OE may edit the verification and manage photos (until the OM approves). */
export const OE_VERIFICATION_STATUSES: readonly FitmentStatus[] = ['SUBMITTED', 'OE_VERIFIED'];
/** Statuses in which an OM may edit the verification and manage photos (after approval: flagged). */
export const OM_VERIFICATION_STATUSES: readonly FitmentStatus[] = ['SUBMITTED', 'OE_VERIFIED', 'OM_APPROVED'];

/**
 * Who may save the verification fields: the task's OE while Submitted or OE verified; an OM also after
 * approval (flagged `postApproval`, see `isPostApprovalEdit`). SA and RO only view (intent table).
 */
export function canEditVerification(actor: WorkflowActor, ctx: WorkflowContext): boolean {
  if (isOm(actor)) return OM_VERIFICATION_STATUSES.includes(ctx.fitment.status);
  if (isTaskOe(actor, ctx)) return OE_VERIFICATION_STATUSES.includes(ctx.fitment.status);
  return false;
}

/** Who may replace or remove photos and upload debug images: the same people and statuses as the verification. */
/** Roles that can ever upload or replace photos (checked before an upload is read; the per-fitment rule is canManagePhotos). */
export const PHOTO_MANAGER_ROLES = ['OM', 'OE'] as const satisfies readonly Role[];

export function canManagePhotos(actor: WorkflowActor, ctx: WorkflowContext): boolean {
  return canEditVerification(actor, ctx);
}

/**
 * Whether the actor is someone who edits verifications at some stage (an OM, or the task's OE). When such a
 * person is refused by the status, the API answers 409 FITMENT_LOCKED instead of 403.
 */
export const isVerificationEditor = (actor: WorkflowActor, ctx: WorkflowContext): boolean => isOm(actor) || isTaskOe(actor, ctx);

/** The 409 FITMENT_LOCKED message when the status no longer allows the change. */
export const verificationLockedMessage = (tkId: string, status: FitmentStatus, what: 'verification' | 'photos'): string =>
  `${tkId} is ${FITMENT_STATUS_LABELS[status]}, so you can no longer change its ${what}.`;

/** Who sees replaced and removed photos (`?history=true`): SA, OM and the task's OE. */
export const canViewPhotoHistory = (actor: WorkflowActor, ctx: Pick<WorkflowContext, 'task'>): boolean =>
  actor.role === 'SUPER_ADMIN' || actor.role === 'OM' || (actor.role === 'OE' && ctx.task.oeId === actor.id);

// --- Photos ---

export const PHOTO_KINDS = ['BEFORE', 'AFTER', 'ASSET', 'CLUSTER', 'PLACEMENT', 'DEBUG'] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];

/** Display order of the kinds (photo lists and the viewer's groups). */
export const PHOTO_KIND_ORDER: readonly PhotoKind[] = ['BEFORE', 'ASSET', 'CLUSTER', 'PLACEMENT', 'AFTER', 'DEBUG'];

export const PHOTO_KIND_LABELS: Record<PhotoKind, string> = {
  BEFORE: 'Before',
  AFTER: 'After',
  ASSET: 'Asset',
  CLUSTER: 'Cluster reading',
  PLACEMENT: 'Device/SIM placement',
  DEBUG: 'Debug image',
};

/** Kinds the technician takes on the phone (F10); the web only uploads DEBUG images. */
export const TECHNICIAN_PHOTO_KINDS: readonly PhotoKind[] = ['BEFORE', 'AFTER', 'ASSET', 'CLUSTER', 'PLACEMENT'];

export const PHOTO_STATUSES = ['ACTIVE', 'REPLACED', 'REMOVED'] as const;
export type PhotoStatus = (typeof PHOTO_STATUSES)[number];

export const PHOTO_SOURCES = ['OT', 'OE', 'OM', 'SIMULATOR'] as const;
export type PhotoSource = (typeof PHOTO_SOURCES)[number];

/** Largest photo upload (10 MB). */
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;

/** Accepted image types (checked by magic bytes on the server, by MIME type in the browser first). */
export const PHOTO_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export const PHOTO_TOO_LARGE_MESSAGE = 'The image must be 10 MB or smaller';
export const PHOTO_UNSUPPORTED_MESSAGE = 'Only JPEG, PNG or WebP images can be uploaded';

/** Sorts photos by kind (PHOTO_KIND_ORDER), then by creation time. */
export function sortPhotos<T extends { kind: PhotoKind; createdAt: string | Date }>(photos: readonly T[]): T[] {
  const time = (v: string | Date) => new Date(v).getTime();
  return [...photos].sort(
    (a, b) => PHOTO_KIND_ORDER.indexOf(a.kind) - PHOTO_KIND_ORDER.indexOf(b.kind) || time(a.createdAt) - time(b.createdAt),
  );
}

/** "Yes", "No" or "" (not decided yet): the billable column of exports and lists. */
export const billableLabel = (billable: boolean | null | undefined): string =>
  billable === true ? 'Yes' : billable === false ? 'No' : '';
