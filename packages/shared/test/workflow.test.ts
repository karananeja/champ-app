import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  FITMENT_ACTIONS,
  FITMENT_STATUSES,
  ROLES,
  approveFitmentsSchema,
  availableActions,
  canApproveFitments,
  canEditFitmentData,
  canPerform,
  canTransition,
  canViewHistory,
  isFitmentAssignable,
  isPostApprovalEdit,
  isTaskUntouched,
  simulateSchema,
  statusAfterAssignment,
  transitionRefusal,
  transitionSchema,
  workflowListQuerySchema,
  type FitmentAction,
  type FitmentStatus,
  type Role,
  type WorkflowContext,
} from '../src';

/** The full transition table (spec §1): action → the statuses it is allowed from. */
const ALLOWED_FROM: Record<FitmentAction, FitmentStatus[]> = {
  START: ['ASSIGNED', 'REOPENED'],
  SUBMIT: ['IN_PROGRESS'],
  CLOSE_NOT_DONE: ['ASSIGNED', 'IN_PROGRESS', 'REOPENED'],
  MARK_FAULTY: ['ASSIGNED', 'IN_PROGRESS', 'REOPENED'],
  VERIFY: ['SUBMITTED'],
  APPROVE: ['OE_VERIFIED'],
  REOPEN: ['SUBMITTED', 'OE_VERIFIED', 'CLOSED_NOT_DONE'],
};

const actor = (role: Role, id = `${role}-1`) => ({ id, role });
const ctx = (status: FitmentStatus, technicianId: string | null = 'OT-1', oeId = 'OE-1'): WorkflowContext => ({
  task: { oeId },
  fitment: { technicianId, status },
});

describe('transition table', () => {
  for (const action of FITMENT_ACTIONS) {
    for (const status of FITMENT_STATUSES) {
      const allowed = ALLOWED_FROM[action].includes(status);
      it(`${action} from ${status} is ${allowed ? 'allowed' : 'refused'}`, () => {
        expect(canTransition(action, status)).toBe(allowed);
      });
    }
  }

  it('refusals name the current status and what the action needs', () => {
    expect(transitionRefusal('APPROVE', 'SUBMITTED')).toBe('This fitment is Submitted; only OE-verified fitments can be final-approved');
    expect(transitionRefusal('START', 'OM_APPROVED')).toBe('This fitment is OM approved; only Assigned or Reopened fitments can be started');
  });
});

describe('canPerform (who)', () => {
  const people = {
    sa: actor('SUPER_ADMIN'),
    om: actor('OM'),
    taskOe: actor('OE', 'OE-1'),
    otherOe: actor('OE', 'OE-2'),
    assignedOt: actor('OT', 'OT-1'),
    otherOt: actor('OT', 'OT-2'),
    ro: actor('RO'),
  };
  const expected: Record<FitmentAction, (keyof typeof people)[]> = {
    START: ['assignedOt'],
    SUBMIT: ['assignedOt'],
    CLOSE_NOT_DONE: ['assignedOt'],
    MARK_FAULTY: ['assignedOt'],
    VERIFY: ['taskOe'],
    APPROVE: ['sa', 'om'],
    REOPEN: ['sa', 'om', 'taskOe'],
  };
  for (const action of FITMENT_ACTIONS) {
    it(`${action}: ${expected[action].join(', ')}`, () => {
      const allowed = (Object.keys(people) as (keyof typeof people)[]).filter((k) => canPerform(action, people[k], ctx('ASSIGNED')));
      expect(allowed).toEqual(expected[action]);
    });
  }

  it('no technician means nobody can do the technician steps; an OT id equal to the OE id is not the OE', () => {
    for (const action of ['START', 'SUBMIT', 'CLOSE_NOT_DONE', 'MARK_FAULTY'] as const) {
      expect(canPerform(action, actor('OT', 'OT-1'), ctx('ASSIGNED', null))).toBe(false);
    }
    expect(canPerform('VERIFY', actor('OT', 'OE-1'), ctx('SUBMITTED'))).toBe(false);
  });

  it('an assigned OE performs the technician steps (D-158); an unassigned OE cannot', () => {
    for (const action of ['START', 'SUBMIT', 'CLOSE_NOT_DONE', 'MARK_FAULTY'] as const) {
      // assigned to their own task's fitment
      expect(canPerform(action, actor('OE', 'OE-1'), ctx('ASSIGNED', 'OE-1'))).toBe(true);
      // assigned OE of another task (assigned by an OM)
      expect(canPerform(action, actor('OE', 'OE-2'), ctx('ASSIGNED', 'OE-2', 'OE-1'))).toBe(true);
      // unassigned OE, even the task's OE
      expect(canPerform(action, actor('OE', 'OE-1'), ctx('ASSIGNED', 'OT-1'))).toBe(false);
      expect(canPerform(action, actor('OE', 'OE-2'), ctx('ASSIGNED', 'OT-1'))).toBe(false);
      // SA/OM/RO never, even with a matching id
      for (const role of ['SUPER_ADMIN', 'OM', 'RO'] as const) expect(canPerform(action, actor(role, 'X'), ctx('ASSIGNED', 'X'))).toBe(false);
    }
    // the task's OE assigned to their own fitment may also verify it
    expect(availableActions(actor('OE', 'OE-1'), ctx('SUBMITTED', 'OE-1'))).toEqual(['VERIFY', 'REOPEN']);
    expect(availableActions(actor('OE', 'OE-1'), ctx('ASSIGNED', 'OE-1'))).toEqual(['START', 'CLOSE_NOT_DONE', 'MARK_FAULTY']);
  });
});

describe('availableActions', () => {
  it('combines who and when', () => {
    expect(availableActions(actor('OT', 'OT-1'), ctx('ASSIGNED'))).toEqual(['START', 'CLOSE_NOT_DONE', 'MARK_FAULTY']);
    expect(availableActions(actor('OT', 'OT-1'), ctx('IN_PROGRESS'))).toEqual(['SUBMIT', 'CLOSE_NOT_DONE', 'MARK_FAULTY']);
    expect(availableActions(actor('OT', 'OT-1'), ctx('REOPENED'))).toEqual(['START', 'CLOSE_NOT_DONE', 'MARK_FAULTY']);
    expect(availableActions(actor('OT', 'OT-1'), ctx('SUBMITTED'))).toEqual([]);
    expect(availableActions(actor('OE', 'OE-1'), ctx('SUBMITTED'))).toEqual(['VERIFY', 'REOPEN']);
    expect(availableActions(actor('OE', 'OE-1'), ctx('OE_VERIFIED'))).toEqual(['REOPEN']);
    expect(availableActions(actor('OE', 'OE-2'), ctx('SUBMITTED'))).toEqual([]);
    expect(availableActions(actor('OM'), ctx('OE_VERIFIED'))).toEqual(['APPROVE', 'REOPEN']);
    expect(availableActions(actor('OM'), ctx('CLOSED_NOT_DONE'))).toEqual(['REOPEN']);
    expect(availableActions(actor('OM'), ctx('OM_APPROVED'))).toEqual([]);
    expect(availableActions(actor('SUPER_ADMIN'), ctx('MOVED_TO_FT'))).toEqual([]);
    for (const status of FITMENT_STATUSES) expect(availableActions(actor('RO'), ctx(status))).toEqual([]);
  });
});

describe('canEditFitmentData (edit locks)', () => {
  const matrix: [string, ReturnType<typeof actor>, FitmentStatus[]][] = [
    ['assigned OT', actor('OT', 'OT-1'), ['ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'REOPENED']],
    ['other OT', actor('OT', 'OT-2'), []],
    ['task OE', actor('OE', 'OE-1'), FITMENT_STATUSES.filter((s) => s !== 'OM_APPROVED')],
    ['other OE', actor('OE', 'OE-2'), []],
    ['OM', actor('OM'), [...FITMENT_STATUSES]],
    ['SA', actor('SUPER_ADMIN'), [...FITMENT_STATUSES]],
    ['RO', actor('RO'), []],
  ];
  for (const [label, who, editable] of matrix) {
    it(`${label}: ${editable.length === FITMENT_STATUSES.length ? 'any status' : editable.join(', ') || 'never'}`, () => {
      expect(FITMENT_STATUSES.filter((s) => canEditFitmentData(who, ctx(s)))).toEqual(editable);
    });
  }

  it('post-approval edits are flagged', () => {
    expect(FITMENT_STATUSES.filter(isPostApprovalEdit)).toEqual(['OM_APPROVED']);
  });
});

describe('assignment and task rules (F04 amended by F05)', () => {
  it('assign is allowed while Open, Assigned or Reopened; Reopened stays Reopened; unassign gives Open', () => {
    expect(FITMENT_STATUSES.filter(isFitmentAssignable)).toEqual(['OPEN', 'ASSIGNED', 'REOPENED']);
    expect(statusAfterAssignment('OPEN', 'ot')).toBe('ASSIGNED');
    expect(statusAfterAssignment('ASSIGNED', 'ot')).toBe('ASSIGNED');
    expect(statusAfterAssignment('REOPENED', 'ot')).toBe('REOPENED');
    expect(statusAfterAssignment('REOPENED', null)).toBe('OPEN');
    expect(statusAfterAssignment('ASSIGNED', null)).toBe('OPEN');
  });

  it('a Reopened fitment does not make a task untouched again', () => {
    expect(isTaskUntouched([{ status: 'ASSIGNED' }, { status: 'REOPENED' }])).toBe(false);
  });

  it('history and approval roles', () => {
    expect(ROLES.filter((r) => canViewHistory({ role: r }))).toEqual(['SUPER_ADMIN', 'OM']);
    expect(ROLES.filter((r) => canApproveFitments({ role: r }))).toEqual(['SUPER_ADMIN', 'OM']);
  });
});

describe('payload schemas', () => {
  const ok = (body: unknown) => transitionSchema.safeParse(body).success;
  const issues = (body: unknown) => {
    const r = transitionSchema.safeParse(body);
    return r.success ? [] : r.error.issues.map((i) => i.message);
  };

  it('START needs the GPS location', () => {
    expect(ok({ action: 'START', payload: { lat: 12.9, lng: 77.6 } })).toBe(true);
    expect(ok({ action: 'START' })).toBe(false);
    expect(ok({ action: 'START', payload: { lat: 12.9 } })).toBe(false);
    expect(ok({ action: 'START', payload: { lat: 91, lng: 0 } })).toBe(false);
  });

  it('CLOSE_NOT_DONE needs a close reason and 1–1000 characters of comments', () => {
    expect(ok({ action: 'CLOSE_NOT_DONE', payload: { closeReasonId: 'cr', comments: 'Locked' } })).toBe(true);
    expect(issues({ action: 'CLOSE_NOT_DONE', payload: { closeReasonId: 'cr', comments: '  ' } })).toEqual(['Add comments']);
    expect(issues({ action: 'CLOSE_NOT_DONE', payload: { comments: 'x' } })).toEqual(['Choose a close reason']);
    expect(ok({ action: 'CLOSE_NOT_DONE', payload: { closeReasonId: 'cr', comments: 'x'.repeat(1001) } })).toBe(false);
  });

  it('MARK_FAULTY needs a reason (1–500); REOPEN a reason of 3–500 characters', () => {
    expect(ok({ action: 'MARK_FAULTY', payload: { reason: 'Dead' } })).toBe(true);
    expect(ok({ action: 'MARK_FAULTY', payload: { reason: '' } })).toBe(false);
    expect(ok({ action: 'MARK_FAULTY', payload: { reason: 'x'.repeat(501) } })).toBe(false);
    expect(ok({ action: 'REOPEN', payload: { reason: 'Redo' } })).toBe(true);
    expect(issues({ action: 'REOPEN', payload: { reason: ' ab ' } })).toEqual(['Give a reason for reopening (at least 3 characters)']);
    expect(issues({ action: 'REOPEN' })).toEqual(['Give a reason for reopening']);
  });

  it('the other actions take an optional note (≤ 500), blanks become null', () => {
    for (const action of ['SUBMIT', 'VERIFY', 'APPROVE']) {
      expect(ok({ action })).toBe(true);
      expect(transitionSchema.parse({ action, payload: { note: ' ' } })).toEqual({ action, payload: { note: null } });
      expect(ok({ action, payload: { note: 'x'.repeat(501) } })).toBe(false);
    }
    expect(ok({ action: 'DANCE' })).toBe(false);
  });

  it('simulate: technician steps only, START location optional', () => {
    expect(simulateSchema.safeParse({ action: 'START' }).success).toBe(true);
    expect(simulateSchema.safeParse({ action: 'VERIFY' }).success).toBe(false);
    expect(simulateSchema.safeParse({ action: 'MARK_FAULTY' }).success).toBe(false);
  });

  it('bulk approve: 1–200 ids; list query defaults and the current flag', () => {
    expect(approveFitmentsSchema.safeParse({ fitmentIds: [] }).success).toBe(false);
    expect(approveFitmentsSchema.safeParse({ fitmentIds: Array.from({ length: 200 }, (_, i) => `f${i}`) }).success).toBe(true);
    expect(approveFitmentsSchema.safeParse({ fitmentIds: Array.from({ length: 201 }, (_, i) => `f${i}`) }).success).toBe(false);
    expect(workflowListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(workflowListQuerySchema.parse({ current: 'true', from: '2026-10-01' })).toMatchObject({ current: true, from: '2026-10-01' });
    expect(z.flattenError(workflowListQuerySchema.safeParse({ to: '1 Oct' }).error!).fieldErrors.to).toEqual(['Use YYYY-MM-DD']);
  });
});
