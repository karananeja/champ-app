import type { Role } from './roles';
import { FITMENT_STATUS_LABELS, type FitmentStatus } from './tasks';
import { isMobileRole } from './mobile';

/**
 * The fitment workflow (F05, D-011, D-077): the single source of truth for transitions, who may perform
 * them and who may edit fitment data. The API engine and the web both use it.
 */

export const FITMENT_ACTIONS = ['START', 'SUBMIT', 'CLOSE_NOT_DONE', 'MARK_FAULTY', 'VERIFY', 'APPROVE', 'REOPEN', 'UNDO_FAULTY'] as const;
export type FitmentAction = (typeof FITMENT_ACTIONS)[number];

export const TRANSITIONS: Record<FitmentAction, { from: readonly FitmentStatus[]; to: FitmentStatus }> = {
  START: { from: ['ASSIGNED', 'REOPENED'], to: 'IN_PROGRESS' },
  SUBMIT: { from: ['IN_PROGRESS'], to: 'SUBMITTED' },
  CLOSE_NOT_DONE: { from: ['ASSIGNED', 'IN_PROGRESS', 'REOPENED'], to: 'CLOSED_NOT_DONE' },
  MARK_FAULTY: { from: ['ASSIGNED', 'IN_PROGRESS', 'REOPENED'], to: 'MOVED_TO_FT' },
  VERIFY: { from: ['SUBMITTED'], to: 'OE_VERIFIED' },
  APPROVE: { from: ['OE_VERIFIED'], to: 'OM_APPROVED' },
  REOPEN: { from: ['SUBMITTED', 'OE_VERIFIED', 'CLOSED_NOT_DONE'], to: 'REOPENED' },
  // CR-11 (D-257): only while the replacement is Open or Assigned (checked by the API engine).
  UNDO_FAULTY: { from: ['MOVED_TO_FT'], to: 'ASSIGNED' },
};

export const FITMENT_ACTION_LABELS: Record<FitmentAction, string> = {
  START: 'Start work',
  SUBMIT: 'Submit',
  CLOSE_NOT_DONE: 'Close not done',
  MARK_FAULTY: 'Mark faulty',
  VERIFY: 'Verify',
  APPROVE: 'Final approve',
  REOPEN: 'Reopen',
  UNDO_FAULTY: 'Undo faulty',
};

/** The technician's steps (mobile app in F10; the dev simulator until then, D-073). */
export const TECHNICIAN_ACTIONS: readonly FitmentAction[] = ['START', 'SUBMIT', 'CLOSE_NOT_DONE', 'MARK_FAULTY'];
export type TechnicianAction = 'START' | 'SUBMIT' | 'CLOSE_NOT_DONE' | 'MARK_FAULTY';

/** The OE/OM steps offered on the web task page. */
export const REVIEW_ACTIONS: readonly FitmentAction[] = ['VERIFY', 'APPROVE', 'REOPEN', 'UNDO_FAULTY'];

export interface WorkflowActor {
  id: string;
  role: Role;
}

export interface WorkflowContext {
  task: { oeId: string };
  fitment: { technicianId: string | null; status: FitmentStatus };
}

const isManager = (actor: WorkflowActor) => actor.role === 'SUPER_ADMIN' || actor.role === 'OM';
const isTaskOe = (actor: WorkflowActor, ctx: WorkflowContext) => actor.role === 'OE' && ctx.task.oeId === actor.id;
/** The assigned technician: an OT, or an OE doing fitments (D-158). */
const isAssignedTechnician = (actor: WorkflowActor, ctx: WorkflowContext) =>
  isMobileRole(actor.role) && !!ctx.fitment.technicianId && ctx.fitment.technicianId === actor.id;

/**
 * Whether the actor may perform the action on this fitment (who, not when; see `canTransition`).
 * Technician steps: the assigned technician only (an OT, or an OE assigned to the fitment, D-158). Verify: the task's OE. Approve: SA or OM. Reopen: SA, OM
 * or the task's OE (D-027). Undo faulty: SA, OM or the task's OE (D-257).
 */
export function canPerform(action: FitmentAction, actor: WorkflowActor, ctx: WorkflowContext): boolean {
  switch (action) {
    case 'START':
    case 'SUBMIT':
    case 'CLOSE_NOT_DONE':
    case 'MARK_FAULTY':
      return isAssignedTechnician(actor, ctx);
    case 'VERIFY':
      return isTaskOe(actor, ctx);
    case 'APPROVE':
      return isManager(actor);
    case 'REOPEN':
    case 'UNDO_FAULTY':
      return isManager(actor) || isTaskOe(actor, ctx);
  }
}

/** Whether the action applies to a fitment in this status. */
export const canTransition = (action: FitmentAction, status: FitmentStatus): boolean =>
  TRANSITIONS[action].from.includes(status);

/** The actions the actor may perform on the fitment now (the web shows these as buttons). */
export const availableActions = (actor: WorkflowActor, ctx: WorkflowContext): FitmentAction[] =>
  FITMENT_ACTIONS.filter((action) => canTransition(action, ctx.fitment.status) && canPerform(action, actor, ctx));

/** Statuses in which the assigned technician may still change the fitment data (until the OE verifies). */
export const TECHNICIAN_EDITABLE_STATUSES: readonly FitmentStatus[] = ['ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'REOPENED'];

/**
 * Edit locks for fitment data: the assigned OT until the OE verifies; the task's OE until the OM approves;
 * SA and OM at any stage (a change after approval is flagged, see `isPostApprovalEdit`).
 */
export function canEditFitmentData(actor: WorkflowActor, ctx: WorkflowContext): boolean {
  if (isManager(actor)) return true;
  if (isTaskOe(actor, ctx)) return ctx.fitment.status !== 'OM_APPROVED';
  if (isAssignedTechnician(actor, ctx)) return TECHNICIAN_EDITABLE_STATUSES.includes(ctx.fitment.status);
  return false;
}

/** A change to an OM-approved fitment, flagged `postApproval` in the history. */
export const isPostApprovalEdit = (status: FitmentStatus): boolean => status === 'OM_APPROVED';

const REFUSALS: Record<FitmentAction, string> = {
  START: 'only Assigned or Reopened fitments can be started',
  SUBMIT: 'only In-progress fitments can be submitted',
  CLOSE_NOT_DONE: 'only Assigned, In-progress or Reopened fitments can be closed as not done',
  MARK_FAULTY: 'only Assigned, In-progress or Reopened fitments can be marked faulty',
  VERIFY: 'only Submitted fitments can be verified',
  APPROVE: 'only OE-verified fitments can be final-approved',
  REOPEN: 'only Submitted, OE-verified or Closed – not done fitments can be reopened',
  UNDO_FAULTY: 'only fitments moved to FT can have their fault marking undone',
};

/** The 409 INVALID_TRANSITION message, e.g. "This fitment is Submitted; only OE-verified fitments can be final-approved". */
export const transitionRefusal = (action: FitmentAction, status: FitmentStatus): string =>
  `This fitment is ${FITMENT_STATUS_LABELS[status]}; ${REFUSALS[action]}`;

/**
 * The built-in Close reasons entry given to a replacement closed by an undo faulty (CR-11, D-257): it can't be
 * renamed or deactivated.
 */
export const FAULT_UNDONE_CLOSE_REASON = { code: 'FAULT_UNDONE', name: 'Faulty marked by mistake' } as const;

/** TaskEvent type written for each action. */
export const FITMENT_ACTION_EVENTS = {
  START: 'FITMENT_STARTED',
  SUBMIT: 'FITMENT_SUBMITTED',
  CLOSE_NOT_DONE: 'FITMENT_CLOSED_NOT_DONE',
  MARK_FAULTY: 'FITMENT_MARKED_FAULTY',
  VERIFY: 'FITMENT_VERIFIED',
  APPROVE: 'FITMENT_APPROVED',
  REOPEN: 'FITMENT_REOPENED',
  UNDO_FAULTY: 'FITMENT_FAULT_UNDONE',
} as const satisfies Record<FitmentAction, string>;

/** Every TaskEvent type (F04, F05, F06 and CR-11). */
export const TASK_EVENT_TYPES = [
  'TASK_CREATED',
  'TASK_UPDATED',
  'TASK_DELETED',
  'FITMENT_ASSIGNED',
  'FITMENT_UNASSIGNED',
  'FITMENT_UPDATED',
  'FITMENT_STARTED',
  'FITMENT_SUBMITTED',
  'FITMENT_CLOSED_NOT_DONE',
  'FITMENT_MARKED_FAULTY',
  'FITMENT_REPLACEMENT_CREATED',
  'FITMENT_VERIFIED',
  'FITMENT_APPROVED',
  'FITMENT_REOPENED',
  // CR-11: a mistaken "faulty" undone
  'FITMENT_FAULT_UNDONE',
  // F06: verification and photos
  'FITMENT_VERIFICATION_SAVED',
  'PHOTO_ADDED',
  'PHOTO_REPLACED',
  'PHOTO_REMOVED',
  // F10B: technician form edits after submit
  'FITMENT_FORM_UPDATED',
  // F11: mobile CSV bulk fill
  'FITMENT_FORM_CSV_FILLED',
] as const;
export type TaskEventType = (typeof TASK_EVENT_TYPES)[number];

export const TASK_EVENT_LABELS: Record<TaskEventType, string> = {
  TASK_CREATED: 'Task created',
  TASK_UPDATED: 'Task edited',
  TASK_DELETED: 'Task deleted',
  FITMENT_ASSIGNED: 'Assigned',
  FITMENT_UNASSIGNED: 'Unassigned',
  FITMENT_UPDATED: 'Fitment edited',
  FITMENT_STARTED: 'Started',
  FITMENT_SUBMITTED: 'Submitted',
  FITMENT_CLOSED_NOT_DONE: 'Closed – not done',
  FITMENT_MARKED_FAULTY: 'Marked faulty',
  FITMENT_REPLACEMENT_CREATED: 'Replacement created',
  FITMENT_VERIFIED: 'OE verified',
  FITMENT_APPROVED: 'OM approved',
  FITMENT_REOPENED: 'Reopened',
  FITMENT_FAULT_UNDONE: 'Fault undone',
  FITMENT_VERIFICATION_SAVED: 'Verification saved',
  PHOTO_ADDED: 'Photo added',
  PHOTO_REPLACED: 'Photo replaced',
  PHOTO_REMOVED: 'Photo removed',
  FITMENT_FORM_UPDATED: 'Form edited',
  FITMENT_FORM_CSV_FILLED: 'Filled from CSV',
};

/** Roles that see the History tab and the raw event log (D-033; RO excluded, D-025). */
export const HISTORY_ROLES: readonly Role[] = ['SUPER_ADMIN', 'OM'];
export const canViewHistory = (actor: { role: Role }): boolean => HISTORY_ROLES.includes(actor.role);

/** Roles that see the Awaiting approval list and can bulk final-approve. */
export const APPROVER_ROLES: readonly Role[] = ['SUPER_ADMIN', 'OM'];
export const canApproveFitments = (actor: { role: Role }): boolean => APPROVER_ROLES.includes(actor.role);

/** Roles that see the Re-opened and Faulty views (an OE only their own tasks). */
export const WORKFLOW_VIEW_ROLES: readonly Role[] = ['SUPER_ADMIN', 'OM', 'OE', 'RO'];

/** Most fitments in one bulk final-approve. */
export const MAX_BULK_APPROVE = 200;
