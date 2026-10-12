import { describe, expect, it } from 'vitest';
import {
  FITMENT_STATUSES,
  PHOTO_KIND_ORDER,
  ROLES,
  billableLabel,
  canEditVerification,
  canManagePhotos,
  canViewPhotoHistory,
  exportTasksQuerySchema,
  isVerificationEditor,
  missingVerificationFields,
  photoReasonSchema,
  sortPhotos,
  transitionSchema,
  updateVerificationSchema,
  uploadPhotoSchema,
  verificationFieldMessage,
  type FitmentStatus,
  type Role,
  type WorkflowContext,
} from '../src';

const actor = (role: Role, id = `${role}-1`) => ({ id, role });
const ctx = (status: FitmentStatus, oeId = 'OE-1'): WorkflowContext => ({ task: { oeId }, fitment: { technicianId: 'OT-1', status } });

describe('required verification fields (D-098)', () => {
  it('lists the empty required fields in form order', () => {
    expect(missingVerificationFields({})).toEqual(['issueObservedId', 'actionTakenId', 'finalIssueId']);
    expect(missingVerificationFields({ issueObservedId: 'a', actionTakenId: null, finalIssueId: '' })).toEqual([
      'actionTakenId',
      'finalIssueId',
    ]);
    expect(missingVerificationFields({ issueObservedId: 'a', actionTakenId: 'b', finalIssueId: 'c' })).toEqual([]);
    expect(verificationFieldMessage('issueObservedId')).toBe('Choose the issue observed at site');
    expect(verificationFieldMessage('finalIssueId')).toBe('Choose the final issue');
  });
});

/** Who may edit the verification (and manage photos) per role and status (spec §3). */
const EDIT_MATRIX: Record<string, FitmentStatus[]> = {
  'OE of the task': ['SUBMITTED', 'OE_VERIFIED'],
  OM: ['SUBMITTED', 'OE_VERIFIED', 'OM_APPROVED'],
  SA: [],
  RO: [],
  'other OE': [],
  OT: [],
};
const ACTORS = {
  'OE of the task': actor('OE', 'OE-1'),
  OM: actor('OM'),
  SA: actor('SUPER_ADMIN'),
  RO: actor('RO'),
  'other OE': actor('OE', 'OE-2'),
  OT: actor('OT', 'OT-1'),
};

describe('canEditVerification and canManagePhotos matrices', () => {
  for (const [who, allowed] of Object.entries(EDIT_MATRIX)) {
    it(`${who}: ${allowed.join(', ') || 'never'}`, () => {
      const a = ACTORS[who as keyof typeof ACTORS];
      for (const status of FITMENT_STATUSES) {
        expect(canEditVerification(a, ctx(status)), `${who} ${status}`).toBe(allowed.includes(status));
        expect(canManagePhotos(a, ctx(status)), `${who} ${status} photos`).toBe(allowed.includes(status));
      }
    });
  }

  it('the OE is blocked after OM approval while the OM is not', () => {
    expect(canEditVerification(ACTORS['OE of the task'], ctx('OM_APPROVED'))).toBe(false);
    expect(canManagePhotos(ACTORS['OE of the task'], ctx('OM_APPROVED'))).toBe(false);
    expect(canEditVerification(ACTORS.OM, ctx('OM_APPROVED'))).toBe(true);
  });

  it('verification editors (409 instead of 403 when locked) are OMs and the task OE', () => {
    expect(isVerificationEditor(ACTORS.OM, ctx('OPEN'))).toBe(true);
    expect(isVerificationEditor(ACTORS['OE of the task'], ctx('OPEN'))).toBe(true);
    for (const who of ['SA', 'RO', 'other OE', 'OT'] as const) expect(isVerificationEditor(ACTORS[who], ctx('OPEN'))).toBe(false);
  });

  it('photo history: SA, OM and the task OE only', () => {
    const seen = ROLES.filter((role) => canViewPhotoHistory(actor(role, role === 'OE' ? 'OE-1' : `${role}-1`), ctx('SUBMITTED')));
    expect(seen).toEqual(['SUPER_ADMIN', 'OM', 'OE']);
    expect(canViewPhotoHistory(ACTORS['other OE'], ctx('SUBMITTED'))).toBe(false);
  });
});

describe('verification and photo schemas', () => {
  it('draft save accepts partial fields and nulls, trims blank remarks to null', () => {
    expect(updateVerificationSchema.parse({})).toEqual({});
    expect(updateVerificationSchema.parse({ issueObservedId: null, oeRemarks: '  ', accessoryIds: ['a'] })).toEqual({
      issueObservedId: null,
      oeRemarks: null,
      accessoryIds: ['a'],
    });
    expect(updateVerificationSchema.safeParse({ oeRemarks: 'x'.repeat(1001) }).success).toBe(false);
  });

  it('VERIFY optionally carries the verification fields', () => {
    const parsed = transitionSchema.parse({ action: 'VERIFY', payload: { finalIssueId: 'f', accessoryIds: [] } });
    expect(parsed).toEqual({ action: 'VERIFY', payload: { finalIssueId: 'f', accessoryIds: [] } });
    expect(transitionSchema.parse({ action: 'VERIFY' })).toEqual({ action: 'VERIFY' });
  });

  it('photo reasons are 3–300 characters; only DEBUG uploads', () => {
    expect(photoReasonSchema.safeParse('ab').success).toBe(false);
    expect(photoReasonSchema.safeParse(' blurry ').data).toBe('blurry');
    expect(photoReasonSchema.safeParse('x'.repeat(301)).success).toBe(false);
    expect(uploadPhotoSchema.parse({})).toEqual({ kind: 'DEBUG' });
    expect(uploadPhotoSchema.safeParse({ kind: 'BEFORE' }).error?.issues[0]?.message).toMatch(/only debug images/);
  });

  it('export level defaults to task', () => {
    expect(exportTasksQuerySchema.parse({}).level).toBe('task');
    expect(exportTasksQuerySchema.parse({ level: 'fitment' }).level).toBe('fitment');
    expect(exportTasksQuerySchema.safeParse({ level: 'photo' }).success).toBe(false);
  });

  it('photos sort by kind order, then time; billable labels', () => {
    const photos = [
      { id: 'debug', kind: 'DEBUG' as const, createdAt: '2026-10-12T00:00:00Z' },
      { id: 'after', kind: 'AFTER' as const, createdAt: '2026-10-12T00:00:00Z' },
      { id: 'before2', kind: 'BEFORE' as const, createdAt: '2026-10-12T01:00:00Z' },
      { id: 'before1', kind: 'BEFORE' as const, createdAt: '2026-10-12T00:00:00Z' },
    ];
    expect(sortPhotos(photos).map((p) => p.id)).toEqual(['before1', 'before2', 'after', 'debug']);
    expect(PHOTO_KIND_ORDER).toEqual(['BEFORE', 'ASSET', 'CLUSTER', 'PLACEMENT', 'AFTER', 'DEBUG']);
    expect([billableLabel(true), billableLabel(false), billableLabel(null)]).toEqual(['Yes', 'No', '']);
  });
});
