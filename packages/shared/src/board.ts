import type { Role } from './roles';
import { FITMENT_STATUS_LABELS, type FitmentStatus } from './tasks';
import { transitionRefusal } from './workflow';

/**
 * The OM kanban board (F07, D-109–D-113): one card per fitment, 6 main columns following the flow (D-011) and
 * 3 side lanes. Drops reuse the existing assign, approve and transition endpoints; `boardMove` decides which
 * drops are allowed and which dialog they open. The API and the web both use it.
 */

/** Main columns, in flow order. */
export const BOARD_COLUMNS = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'OE_VERIFIED', 'OM_APPROVED'] as const satisfies readonly FitmentStatus[];

/** Side lanes (collapsible "Other" area). */
export const BOARD_LANES = ['REOPENED', 'CLOSED_NOT_DONE', 'MOVED_TO_FT'] as const satisfies readonly FitmentStatus[];

/** Every board status, main columns first. */
export const BOARD_STATUSES: readonly FitmentStatus[] = [...BOARD_COLUMNS, ...BOARD_LANES];

/** Finished columns: they show the last 7 days (by status timestamp) unless a fitment-date range is set (D-111). */
export const FINISHED_STATUSES = ['OM_APPROVED', 'CLOSED_NOT_DONE', 'MOVED_TO_FT'] as const satisfies readonly FitmentStatus[];
export type FinishedStatus = (typeof FINISHED_STATUSES)[number];

/** The fitment timestamp the finished window is measured on. */
export const FINISHED_STATUS_TIMESTAMPS: Record<FinishedStatus, 'approvedAt' | 'closedAt' | 'faultyAt'> = {
  OM_APPROVED: 'approvedAt',
  CLOSED_NOT_DONE: 'closedAt',
  MOVED_TO_FT: 'faultyAt',
};

/** Days of finished work shown when no fitment-date range is set (D-111). */
export const FINISHED_WINDOW_DAYS = 7;

export const isFinishedStatus = (status: FitmentStatus): status is FinishedStatus =>
  (FINISHED_STATUSES as readonly FitmentStatus[]).includes(status);

/** Cards per column page (default and maximum of `pageSize`). */
export const BOARD_PAGE_SIZE = 50;
export const BOARD_MAX_PAGE_SIZE = 100;

export const BOARD_MOVE_KINDS = ['ASSIGN', 'UNASSIGN', 'APPROVE', 'REOPEN'] as const;
export type BoardMoveKind = (typeof BOARD_MOVE_KINDS)[number];
export interface BoardMove {
  kind: BoardMoveKind;
}

/**
 * The action a drop from `from` to `to` stands for, or null when the board can't do it:
 * Open → Assigned assigns, Assigned → Open unassigns, OE verified → OM approved final-approves, and Submitted,
 * OE verified or Closed – not done → Reopened reopens. Everything else (technician and OE steps, finished
 * fitments, same column) is null.
 */
export function boardMove(from: FitmentStatus, to: FitmentStatus): BoardMove | null {
  if (from === 'OPEN' && to === 'ASSIGNED') return { kind: 'ASSIGN' };
  if (from === 'ASSIGNED' && to === 'OPEN') return { kind: 'UNASSIGN' };
  if (from === 'OE_VERIFIED' && to === 'OM_APPROVED') return { kind: 'APPROVE' };
  if (to === 'REOPENED' && (from === 'SUBMITTED' || from === 'OE_VERIFIED' || from === 'CLOSED_NOT_DONE')) return { kind: 'REOPEN' };
  return null;
}

/** The statuses a card in `from` may be moved to (the "Move to…" menu). */
export const boardTargets = (from: FitmentStatus): FitmentStatus[] => BOARD_STATUSES.filter((to) => boardMove(from, to) !== null);

/**
 * Why a drop is refused, in words (shown in a toast; the card snaps back); null for an allowed move. Reuses
 * the workflow's `transitionRefusal` for approve and reopen.
 */
export function boardMoveRefusal(from: FitmentStatus, to: FitmentStatus): string | null {
  if (boardMove(from, to)) return null;
  if (from === to) return `This fitment is already ${FITMENT_STATUS_LABELS[from]}`;
  if (from === 'OM_APPROVED') return "Approved fitments can't be moved";
  if (from === 'MOVED_TO_FT') return "Fitments moved to FT can't be moved; their replacement carries on";
  switch (to) {
    case 'IN_PROGRESS':
    case 'SUBMITTED':
      return 'Only the technician can start or submit work';
    case 'CLOSED_NOT_DONE':
      return 'Only the technician can close a fitment as not done';
    case 'MOVED_TO_FT':
      return 'Only the technician can mark a fitment faulty';
    case 'OE_VERIFIED':
      return 'Verification is done by the OE from the task page';
    case 'OM_APPROVED':
      return transitionRefusal('APPROVE', from);
    case 'REOPENED':
      return transitionRefusal('REOPEN', from);
    case 'ASSIGNED':
      return from === 'REOPENED'
        ? 'A reopened fitment stays Reopened; change its technician from the quick view'
        : `This fitment is ${FITMENT_STATUS_LABELS[from]}; only Open fitments can be assigned`;
    case 'OPEN':
      return from === 'REOPENED'
        ? 'A reopened fitment can be unassigned from the task page'
        : `This fitment is ${FITMENT_STATUS_LABELS[from]}; only Assigned fitments can be unassigned`;
  }
}

/** Roles that see the board (SA and OM). */
export const BOARD_ROLES: readonly Role[] = ['SUPER_ADMIN', 'OM'];
export const canUseBoard = (user: { role: Role }): boolean => BOARD_ROLES.includes(user.role);
