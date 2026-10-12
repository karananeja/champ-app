import { describe, expect, it } from 'vitest';
import {
  BOARD_COLUMNS,
  BOARD_LANES,
  BOARD_STATUSES,
  FINISHED_STATUSES,
  FITMENT_STATUSES,
  ROLES,
  boardColumnQuerySchema,
  boardMove,
  boardMoveRefusal,
  boardQuerySchema,
  boardTargets,
  canUseBoard,
  isFinishedStatus,
  type BoardMoveKind,
  type FitmentStatus,
} from '../src';

/** The allowed drops (spec §1); every other pair of the 9×9 matrix is refused. */
const ALLOWED: Partial<Record<`${FitmentStatus}>${FitmentStatus}`, BoardMoveKind>> = {
  'OPEN>ASSIGNED': 'ASSIGN',
  'ASSIGNED>OPEN': 'UNASSIGN',
  'OE_VERIFIED>OM_APPROVED': 'APPROVE',
  'SUBMITTED>REOPENED': 'REOPEN',
  'OE_VERIFIED>REOPENED': 'REOPEN',
  'CLOSED_NOT_DONE>REOPENED': 'REOPEN',
};

describe('board layout', () => {
  it('has 6 main columns in flow order, 3 side lanes and 3 finished statuses', () => {
    expect(BOARD_COLUMNS).toEqual(['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'OE_VERIFIED', 'OM_APPROVED']);
    expect(BOARD_LANES).toEqual(['REOPENED', 'CLOSED_NOT_DONE', 'MOVED_TO_FT']);
    expect([...BOARD_STATUSES].sort()).toEqual([...FITMENT_STATUSES].sort());
    expect(FINISHED_STATUSES).toEqual(['OM_APPROVED', 'CLOSED_NOT_DONE', 'MOVED_TO_FT']);
    expect(FITMENT_STATUSES.filter(isFinishedStatus)).toEqual(['OM_APPROVED', 'CLOSED_NOT_DONE', 'MOVED_TO_FT']);
  });
});

describe('boardMove matrix (9×9)', () => {
  for (const from of FITMENT_STATUSES) {
    for (const to of FITMENT_STATUSES) {
      const kind = ALLOWED[`${from}>${to}`];
      it(`${from} → ${to}: ${kind ?? 'refused'}`, () => {
        expect(boardMove(from, to)).toEqual(kind ? { kind } : null);
        const refusal = boardMoveRefusal(from, to);
        if (kind) expect(refusal).toBeNull();
        else expect(refusal).toMatch(/\S/);
      });
    }
  }

  it('lists the allowed targets for the "Move to…" menu', () => {
    expect(boardTargets('OPEN')).toEqual(['ASSIGNED']);
    expect(boardTargets('ASSIGNED')).toEqual(['OPEN']);
    expect(boardTargets('OE_VERIFIED')).toEqual(['OM_APPROVED', 'REOPENED']);
    expect(boardTargets('SUBMITTED')).toEqual(['REOPENED']);
    expect(boardTargets('CLOSED_NOT_DONE')).toEqual(['REOPENED']);
    for (const s of ['IN_PROGRESS', 'OM_APPROVED', 'MOVED_TO_FT', 'REOPENED'] as const) expect(boardTargets(s)).toEqual([]);
  });
});

describe('boardMoveRefusal', () => {
  it('explains why, reusing the workflow messages', () => {
    expect(boardMoveRefusal('ASSIGNED', 'SUBMITTED')).toBe('Only the technician can start or submit work');
    expect(boardMoveRefusal('ASSIGNED', 'IN_PROGRESS')).toBe('Only the technician can start or submit work');
    expect(boardMoveRefusal('SUBMITTED', 'OE_VERIFIED')).toBe('Verification is done by the OE from the task page');
    expect(boardMoveRefusal('OM_APPROVED', 'REOPENED')).toBe("Approved fitments can't be moved");
    expect(boardMoveRefusal('OM_APPROVED', 'OE_VERIFIED')).toBe("Approved fitments can't be moved");
    expect(boardMoveRefusal('MOVED_TO_FT', 'OPEN')).toMatch(/^Fitments moved to FT can't be moved/);
    expect(boardMoveRefusal('ASSIGNED', 'CLOSED_NOT_DONE')).toBe('Only the technician can close a fitment as not done');
    expect(boardMoveRefusal('IN_PROGRESS', 'MOVED_TO_FT')).toBe('Only the technician can mark a fitment faulty');
    expect(boardMoveRefusal('SUBMITTED', 'OM_APPROVED')).toBe('This fitment is Submitted; only OE-verified fitments can be final-approved');
    expect(boardMoveRefusal('ASSIGNED', 'REOPENED')).toBe(
      'This fitment is Assigned; only Submitted, OE-verified or Closed – not done fitments can be reopened',
    );
    expect(boardMoveRefusal('SUBMITTED', 'ASSIGNED')).toBe('This fitment is Submitted; only Open fitments can be assigned');
    expect(boardMoveRefusal('REOPENED', 'ASSIGNED')).toMatch(/change its technician from the quick view/);
    expect(boardMoveRefusal('OPEN', 'OPEN')).toBe('This fitment is already Open');
    expect(boardMoveRefusal('IN_PROGRESS', 'OPEN')).toBe('This fitment is In progress; only Assigned fitments can be unassigned');
  });
});

describe('canUseBoard', () => {
  it('is SA and OM only', () => {
    expect(ROLES.filter((role) => canUseBoard({ role }))).toEqual(['SUPER_ADMIN', 'OM']);
  });
});

describe('board query', () => {
  it('defaults to 50 cards per column, at most 100; the column query adds page', () => {
    expect(boardQuerySchema.parse({})).toEqual({ pageSize: 50 });
    expect(boardQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false);
    expect(boardQuerySchema.safeParse({ from: '12-10-2026' }).success).toBe(false);
    expect(boardColumnQuerySchema.parse({ page: '3', q: ' TK-1 ' })).toEqual({ page: 3, pageSize: 50, q: 'TK-1' });
  });
});
