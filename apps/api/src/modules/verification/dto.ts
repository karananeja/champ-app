import type { FitmentVerificationDto, PhotoCounts, PhotoKind, TaskRef } from '@champ/shared';
import type { Prisma } from '../../generated/prisma/client';

const refSelect = { id: true, name: true, code: true, active: true } satisfies Prisma.LookupItemSelect;

/** What a fitment DTO needs for its verification and photo counts (merged into `fitmentInclude`). */
export const verificationInclude = {
  issueObserved: { select: refSelect },
  actionTaken: { select: refSelect },
  finalIssue: { select: { ...refSelect, billable: true } },
  accessories: { select: { accessory: { select: refSelect } } },
  verificationUpdatedBy: { select: { id: true, name: true } },
  photos: { where: { status: 'ACTIVE' }, select: { kind: true } },
} satisfies Prisma.FitmentInclude;
export type VerificationRow = Prisma.FitmentGetPayload<{ include: typeof verificationInclude }>;

const byName = (a: TaskRef, b: TaskRef) => a.name.localeCompare(b.name);

/** The verification of a fitment, names resolved (inactive values keep `active: false`). */
export function toVerificationDto(f: VerificationRow): FitmentVerificationDto {
  return {
    issueObserved: f.issueObserved,
    actionTaken: f.actionTaken,
    accessories: f.accessories.map((a) => a.accessory).sort(byName),
    oeRemarks: f.oeRemarks,
    otRemarks: f.otRemarks,
    finalIssue: f.finalIssue && { ...f.finalIssue, billable: f.finalIssue.billable ?? false },
    billable: f.billable,
    updatedAt: f.verificationUpdatedAt ? f.verificationUpdatedAt.toISOString() : null,
    updatedBy: f.verificationUpdatedBy,
  };
}

/** Active photos in total and per kind. */
export function photoCounts(photos: readonly { kind: PhotoKind }[]): PhotoCounts {
  const byKind: PhotoCounts['byKind'] = {};
  for (const { kind } of photos) byKind[kind] = (byKind[kind] ?? 0) + 1;
  return { active: photos.length, byKind };
}
