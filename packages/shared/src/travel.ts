import type { Role } from './roles';
import { PHOTO_CONTENT_TYPES, PHOTO_MAX_BYTES } from './verification';

/**
 * Travel tasks (F08, D-119–D-122): a technician's trip outside a planned fitment, recorded and verified so
 * reimbursement can be processed outside Champ (D-018). Who may raise, verify, edit and resubmit, the status
 * flow and the list scope live here; the API and the web both use them.
 */

// --- Statuses and actions (D-120) ---

export const TRAVEL_STATUSES = ['RAISED', 'VERIFIED', 'REJECTED'] as const;
export type TravelStatus = (typeof TRAVEL_STATUSES)[number];

export const TRAVEL_STATUS_LABELS: Record<TravelStatus, string> = {
  RAISED: 'Raised',
  VERIFIED: 'Verified',
  REJECTED: 'Rejected',
};

/** Where a TT was raised: on the web (SA, OM, OE on a technician's behalf) or in the field app (the OT). */
export const TRAVEL_SOURCES = ['WEB', 'MOBILE'] as const;
export type TravelSource = (typeof TRAVEL_SOURCES)[number];

export const TRAVEL_SOURCE_LABELS: Record<TravelSource, string> = { WEB: 'Web', MOBILE: 'Field app' };

export const TRAVEL_ACTIONS = ['VERIFY', 'REJECT', 'RESUBMIT', 'REOPEN'] as const;
export type TravelAction = (typeof TRAVEL_ACTIONS)[number];

export const TRAVEL_TRANSITIONS: Record<TravelAction, { from: TravelStatus; to: TravelStatus }> = {
  VERIFY: { from: 'RAISED', to: 'VERIFIED' },
  REJECT: { from: 'RAISED', to: 'REJECTED' },
  RESUBMIT: { from: 'REJECTED', to: 'RAISED' },
  REOPEN: { from: 'VERIFIED', to: 'RAISED' },
};

export const TRAVEL_ACTION_LABELS: Record<TravelAction, string> = {
  VERIFY: 'Verify',
  REJECT: 'Reject',
  RESUBMIT: 'Resubmit',
  REOPEN: 'Reopen',
};

/** Statuses in which a TT can still be edited (a verified TT is locked, D-120). */
export const TRAVEL_EDITABLE_STATUSES: readonly TravelStatus[] = ['RAISED', 'REJECTED'];

// --- Ids (TT-00001) ---

export const formatTtId = (n: number): string => `TT-${String(n).padStart(5, '0')}`;

/** Reads a TT id typed into a search box: `TT-00001`, `tt-1`, `TT1` or a bare `1`. Null when it isn't one. */
export function parseTravelId(text: string): number | null {
  const match = /^(?:tt)?[\s-]?(\d{1,9})$/i.exec(text.trim());
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

// --- Who may do what (spec §2, D-121) ---

export interface TravelActor {
  id: string;
  role: Role;
}

/** The technician of a TT (or the one a TT is being raised for): who they report to. */
export interface TravelTechnician {
  id: string;
  managerId: string | null;
}

/** What the rules need of a TT. */
export interface TravelContext {
  status: TravelStatus;
  raisedById: string;
}

/** Roles that can open travel tasks (an OE their technicians' only, an OT their own; F09+ for the OT). */
export const TRAVEL_VIEW_ROLES: readonly Role[] = ['SUPER_ADMIN', 'OM', 'OE', 'OT', 'RO'];
/** Roles that can raise TTs (each limited by `canRaiseTravel`); also the role gate of attachment uploads (D-108). */
export const TRAVEL_RAISE_ROLES: readonly Role[] = ['SUPER_ADMIN', 'OM', 'OE', 'OT'];
/** Roles that may see the "Raise travel task" button on the web (OTs raise from the field app). */
export const TRAVEL_WEB_RAISE_ROLES: readonly Role[] = ['SUPER_ADMIN', 'OM', 'OE'];

export const canViewTravel = (actor: { role: Role }): boolean => TRAVEL_VIEW_ROLES.includes(actor.role);
export const canRaiseTravelOnWeb = (actor: { role: Role }): boolean => TRAVEL_WEB_RAISE_ROLES.includes(actor.role);

const isManagerOf = (actor: TravelActor, tech: TravelTechnician) => !!tech.managerId && tech.managerId === actor.id;

/** SA and OM for any technician; an OE for their own technicians; an OT for themselves (mobile). */
export function canRaiseTravel(actor: TravelActor, tech: TravelTechnician): boolean {
  switch (actor.role) {
    case 'SUPER_ADMIN':
    case 'OM':
      return true;
    case 'OE':
      return isManagerOf(actor, tech);
    case 'OT':
      return tech.id === actor.id;
    default:
      return false;
  }
}

/** The source of a TT raised by this actor: the OT raises from the field app, everyone else on the web. */
export const travelSourceFor = (actor: { role: Role }): TravelSource => (actor.role === 'OT' ? 'MOBILE' : 'WEB');

/** Verify and reject (D-121): any OM, or the technician's reporting OE. SA only views. */
export const canVerifyTravel = (actor: TravelActor, tech: TravelTechnician): boolean =>
  actor.role === 'OM' || (actor.role === 'OE' && isManagerOf(actor, tech));

const isRaiserOrOm = (actor: TravelActor, tt: TravelContext) => actor.role === 'OM' || tt.raisedById === actor.id;

/** Edit (and resubmit): while Raised or Rejected, by the person who raised it or an OM. */
export const canEditTravel = (actor: TravelActor, tt: TravelContext): boolean =>
  TRAVEL_EDITABLE_STATUSES.includes(tt.status) && isRaiserOrOm(actor, tt);

/** Add or remove receipts: whoever can edit, or the verifier while the TT is Raised. */
export const canManageTravelAttachments = (actor: TravelActor, tt: TravelContext, tech: TravelTechnician): boolean =>
  canEditTravel(actor, tt) || (tt.status === 'RAISED' && canVerifyTravel(actor, tech));

/** Whether the actor is the right person for the action (who, not when; see `canTransitionTravel`). */
export function canPerformTravel(action: TravelAction, actor: TravelActor, tt: TravelContext, tech: TravelTechnician): boolean {
  switch (action) {
    case 'VERIFY':
    case 'REJECT':
      return canVerifyTravel(actor, tech);
    case 'RESUBMIT':
      return isRaiserOrOm(actor, tt);
    case 'REOPEN':
      return actor.role === 'OM';
  }
}

export const canTransitionTravel = (action: TravelAction, status: TravelStatus): boolean => TRAVEL_TRANSITIONS[action].from === status;

/** The actions the actor may take on the TT now (the web shows these as buttons). */
export const availableTravelActions = (actor: TravelActor, tt: TravelContext, tech: TravelTechnician): TravelAction[] =>
  TRAVEL_ACTIONS.filter((action) => canTransitionTravel(action, tt.status) && canPerformTravel(action, actor, tt, tech));

/**
 * Which TTs an actor sees: SA, OM and RO all; an OE those whose technician reports to them; an OT their own;
 * nobody else any.
 */
export type TravelScope = { kind: 'all' } | { kind: 'team'; managerId: string } | { kind: 'own'; technicianId: string } | { kind: 'none' };

export function travelScope(actor: TravelActor): TravelScope {
  switch (actor.role) {
    case 'SUPER_ADMIN':
    case 'OM':
    case 'RO':
      return { kind: 'all' };
    case 'OE':
      return { kind: 'team', managerId: actor.id };
    case 'OT':
      return { kind: 'own', technicianId: actor.id };
    default:
      return { kind: 'none' };
  }
}

/** Whether a TT of this technician is in the actor's scope. */
export function isInTravelScope(actor: TravelActor, tech: TravelTechnician): boolean {
  const scope = travelScope(actor);
  if (scope.kind === 'all') return true;
  if (scope.kind === 'team') return tech.managerId === scope.managerId;
  if (scope.kind === 'own') return tech.id === scope.technicianId;
  return false;
}

// --- Refusals (F05 style) ---

const REFUSALS: Record<TravelAction, string> = {
  VERIFY: 'only Raised travel tasks can be verified',
  REJECT: 'only Raised travel tasks can be rejected',
  RESUBMIT: 'only Rejected travel tasks can be resubmitted',
  REOPEN: 'only Verified travel tasks can be reopened',
};

/** 409 INVALID_TRANSITION, e.g. "TT-00001 is Verified; only Raised travel tasks can be verified". */
export const travelTransitionRefusal = (ttId: string, action: TravelAction, status: TravelStatus): string =>
  `${ttId} is ${TRAVEL_STATUS_LABELS[status]}; ${REFUSALS[action]}`;

/** 403 messages when `canPerformTravel` refuses. */
export const TRAVEL_NOT_ALLOWED: Record<TravelAction, string> = {
  VERIFY: "Only an operations manager or the technician's operation executive can verify this travel task",
  REJECT: "Only an operations manager or the technician's operation executive can reject this travel task",
  RESUBMIT: 'Only the person who raised this travel task or an operations manager can resubmit it',
  REOPEN: 'Only an operations manager can reopen a verified travel task',
};

/** 409 when the TT is locked for edits (Verified). */
export const travelLockedMessage = (ttId: string, status: TravelStatus): string =>
  `${ttId} is ${TRAVEL_STATUS_LABELS[status]}, so it can no longer be changed${status === 'VERIFIED' ? '; an operations manager can reopen it' : ''}`;

// --- History ---

export const TRAVEL_EVENT_TYPES = [
  'TT_RAISED',
  'TT_UPDATED',
  'TT_VERIFIED',
  'TT_REJECTED',
  'TT_RESUBMITTED',
  'TT_REOPENED',
  'TT_ATTACHMENT_ADDED',
  'TT_ATTACHMENT_REMOVED',
] as const;
export type TravelEventType = (typeof TRAVEL_EVENT_TYPES)[number];

export const TRAVEL_EVENT_LABELS: Record<TravelEventType, string> = {
  TT_RAISED: 'Raised',
  TT_UPDATED: 'Edited',
  TT_VERIFIED: 'Verified',
  TT_REJECTED: 'Rejected',
  TT_RESUBMITTED: 'Resubmitted',
  TT_REOPENED: 'Reopened',
  TT_ATTACHMENT_ADDED: 'Receipt added',
  TT_ATTACHMENT_REMOVED: 'Receipt removed',
};

export const TRAVEL_ACTION_EVENTS = {
  VERIFY: 'TT_VERIFIED',
  REJECT: 'TT_REJECTED',
  RESUBMIT: 'TT_RESUBMITTED',
  REOPEN: 'TT_REOPENED',
} as const satisfies Record<TravelAction, TravelEventType>;

/** Readable names of the fields in TT_UPDATED / TT_RESUBMITTED diffs (the diff keys). */
export const TRAVEL_FIELD_LABELS = {
  technician: 'Technician',
  location: 'Location',
  customer: 'Customer',
  purpose: 'Purpose of travel',
  travelDate: 'Travel date',
  relatedTask: 'Related task',
  distanceKm: 'Distance (km)',
} as const;

// --- Fields and receipts (D-119) ---

export const TRAVEL_PURPOSE_MIN = 3;
export const TRAVEL_PURPOSE_MAX = 1000;
export const TRAVEL_REASON_MIN = 3;
export const TRAVEL_REASON_MAX = 500;
/** Distance bounds: more than 0, at most 5,000 km, one decimal. */
export const TRAVEL_MAX_DISTANCE_KM = 5000;

/** Receipts: images (as F06 photos) or PDF, up to 10 MB each, at most 10 active per TT. */
export const TRAVEL_ATTACHMENT_CONTENT_TYPES = [...PHOTO_CONTENT_TYPES, 'application/pdf'] as const;
export type TravelAttachmentContentType = (typeof TRAVEL_ATTACHMENT_CONTENT_TYPES)[number];
export const TRAVEL_ATTACHMENT_MAX_BYTES = PHOTO_MAX_BYTES;
export const TRAVEL_MAX_ATTACHMENTS = 10;
export const TRAVEL_ATTACHMENT_TOO_LARGE_MESSAGE = 'The file must be 10 MB or smaller';
export const TRAVEL_ATTACHMENT_UNSUPPORTED_MESSAGE = 'Only JPEG, PNG or WebP images or PDF files can be uploaded';
export const travelAttachmentLimitMessage = (ttId: string) =>
  `${ttId} already has ${TRAVEL_MAX_ATTACHMENTS} receipts; remove one before adding another`;

export const TRAVEL_ATTACHMENT_STATUSES = ['ACTIVE', 'REMOVED'] as const;
export type TravelAttachmentStatus = (typeof TRAVEL_ATTACHMENT_STATUSES)[number];

export const isPdf = (contentType: string): boolean => contentType === 'application/pdf';

/** Today's IST calendar day, `YYYY-MM-DD` (a travel date may not be later). */
export function istTodayDay(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

// --- Lists ---

export const TRAVEL_SORTS = ['travelDate:desc', 'travelDate:asc', 'createdAt:desc', 'createdAt:asc'] as const;
export type TravelSort = (typeof TRAVEL_SORTS)[number];
export const DEFAULT_TRAVEL_SORT: TravelSort = 'travelDate:desc';

/** Fitments offered by the related-task lookup. */
export const FITMENT_LOOKUP_LIMIT = 10;
