import {
  availableActions,
  canDeleteTask,
  canEditFitmentData,
  canEditVerification,
  canManagePhotos,
  canManageTask,
  canViewHistory,
  formatOeId,
  formatOmId,
  formatTkId,
  isFitmentAssignable,
  isTaskUntouched,
  type FitmentCounts,
  type FitmentDto,
  type TaskDto,
  type TaskListItemDto,
  type TaskRef,
} from '@champ/shared';
import type { Prisma } from '../../generated/prisma/client';
import type { User } from '../../lib/prisma';
import { photoCounts, toVerificationDto, verificationInclude } from '../verification/dto';
import { toFormDto } from '../mobile/form';

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

const refSelect = { id: true, name: true, code: true, active: true } satisfies Prisma.LookupItemSelect;
const toRef = (r: { id: string; name: string; code: string | null; active: boolean }): TaskRef => ({
  id: r.id,
  name: r.name,
  code: r.code,
  active: r.active,
});

const technicianSelect = { id: true, name: true, technicianType: true } satisfies Prisma.UserSelect;

/** Counts of a task's fitments: assigned = has a technician, open = status Open. */
export function countFitments(fitments: readonly { status: string; technicianId: string | null }[]): FitmentCounts {
  return {
    total: fitments.length,
    assigned: fitments.filter((f) => f.technicianId).length,
    open: fitments.filter((f) => f.status === 'OPEN').length,
  };
}

// --- List rows ---

export const taskListInclude = {
  client: { select: { id: true, name: true, code: true } },
  site: { select: { id: true, name: true } },
  location: { select: { city: true } },
  assetType: { select: { id: true, name: true } },
  activity: { select: { id: true, name: true } },
  oe: { select: { id: true, name: true } },
  fitments: { select: { status: true, technicianId: true, verifiedAt: true, billable: true } },
} satisfies Prisma.TaskInclude;
type TaskListRow = Prisma.TaskGetPayload<{ include: typeof taskListInclude }>;

export function toTaskListItem(task: TaskListRow): TaskListItemDto {
  return {
    id: task.id,
    omId: formatOmId(task.omNo),
    oeTaskId: formatOeId(task.oeNo),
    status: task.status,
    client: task.client,
    site: task.site,
    city: task.location.city,
    assetType: task.assetType,
    activity: task.activity,
    oe: task.oe,
    fitments: countFitments(task.fitments),
    fitmentAt: iso(task.fitmentAt),
    createdAt: iso(task.createdAt),
    completedAt: isoOrNull(task.completedAt),
    ...verificationCounts(task.fitments),
  };
}

/** F06: fitments currently verified (verifiedAt is cleared by a reopen) and, of those, billable. */
export function verificationCounts(fitments: readonly { verifiedAt: Date | null; billable: boolean | null }[]) {
  const verified = fitments.filter((f) => f.verifiedAt);
  return { verifiedCount: verified.length, billableCount: verified.filter((f) => f.billable === true).length };
}

// --- Detail ---

const userRef = { select: { id: true, name: true } } as const;

/** A fitment with the names its DTO shows (technician, reviewers, close reason, replacement links). */
export const fitmentInclude = {
  technician: { select: technicianSelect },
  verifiedBy: userRef,
  approvedBy: userRef,
  closeReason: { select: { id: true, name: true } },
  replacementOf: { select: { id: true, tkNo: true } },
  replacement: { select: { id: true, tkNo: true, status: true } },
  ...verificationInclude,
} satisfies Prisma.FitmentInclude;
export type FitmentRow = Prisma.FitmentGetPayload<{ include: typeof fitmentInclude }>;

export const taskDetailInclude = {
  taskType: { select: refSelect },
  client: { select: { id: true, name: true, code: true, active: true } },
  site: { select: { id: true, name: true, address: true, lat: true, lng: true, active: true } },
  location: { select: { id: true, city: true, state: { select: { name: true } } } },
  oe: { select: { id: true, name: true, status: true } },
  assetType: { select: refSelect },
  activity: { select: { id: true, name: true, active: true } },
  deviceType: { select: refSelect },
  makeModel: { select: { id: true, make: true, model: true, active: true } },
  installationType: { select: refSelect },
  shiftType: { select: refSelect },
  issueReported: { select: refSelect },
  createdBy: { select: { id: true, name: true } },
  fitments: { include: fitmentInclude, orderBy: { seq: 'asc' } },
} satisfies Prisma.TaskInclude;
export type TaskDetailRow = Prisma.TaskGetPayload<{ include: typeof taskDetailInclude }>;

/**
 * A fitment as the caller sees it: data, workflow fields and, from the shared state machine, the actions
 * the caller may take and whether they may edit the data.
 */
export function toFitmentDto(f: FitmentRow, task: { oeId: string }, actor: User): FitmentDto {
  const ctx = { task, fitment: f };
  return {
    id: f.id,
    tkId: formatTkId(f.tkNo),
    seq: f.seq,
    status: f.status,
    technician: f.technician,
    vehicleRegNo: f.vehicleRegNo,
    chassisNo: f.chassisNo,
    assetNumber: f.assetNumber,
    oldDeviceId: f.oldDeviceId,
    availableActions: availableActions(actor, ctx),
    canEditData: canEditFitmentData(actor, ctx),
    startedAt: isoOrNull(f.startedAt),
    startLat: f.startLat,
    startLng: f.startLng,
    submittedAt: isoOrNull(f.submittedAt),
    verifiedAt: isoOrNull(f.verifiedAt),
    verifiedBy: f.verifiedBy,
    approvedAt: isoOrNull(f.approvedAt),
    approvedBy: f.approvedBy,
    closedAt: isoOrNull(f.closedAt),
    closeReason: f.closeReason,
    closeComments: f.closeComments,
    faultyAt: isoOrNull(f.faultyAt),
    faultReason: f.faultReason,
    replacementOf: f.replacementOf && { id: f.replacementOf.id, tkId: formatTkId(f.replacementOf.tkNo) },
    replacement: f.replacement && {
      id: f.replacement.id,
      tkId: formatTkId(f.replacement.tkNo),
      status: f.replacement.status,
    },
    reopenCount: f.reopenCount,
    lastReopenReason: f.lastReopenReason,
    lastReopenedAt: isoOrNull(f.lastReopenedAt),
    verification: toVerificationDto(f),
    technicianForm: toFormDto(f),
    photoCounts: photoCounts(f.photos),
    canEditVerification: canEditVerification(actor, ctx),
    canManagePhotos: canManagePhotos(actor, ctx),
  };
}

/** What the caller may do with the task (spec §3, the untouched rule and the F05 History tab). */
export function taskPermissions(actor: User, task: { oeId: string; fitments: readonly { status: FitmentDto['status'] }[] }) {
  const manage = canManageTask(actor, task);
  const untouched = isTaskUntouched(task.fitments);
  // F05: SA/OM can edit the header at any stage (flagged postStart once work started); an OE only while untouched.
  const editAnyStage = actor.role === 'SUPER_ADMIN' || actor.role === 'OM';
  return {
    canEdit: manage && (untouched || editAnyStage),
    canAssign: manage && task.fitments.some((f) => isFitmentAssignable(f.status)),
    canDelete: canDeleteTask(actor) && untouched,
    canViewHistory: canViewHistory(actor),
  };
}

export function toTaskDto(task: TaskDetailRow, actor: User): TaskDto {
  return {
    id: task.id,
    omId: formatOmId(task.omNo),
    oeTaskId: formatOeId(task.oeNo),
    status: task.status,
    taskType: toRef(task.taskType),
    client: toRef(task.client),
    site: task.site,
    location: { id: task.location.id, city: task.location.city, state: task.location.state.name },
    pocName: task.pocName,
    pocPhone: task.pocPhone,
    pocEmail: task.pocEmail,
    oeId: task.oeId,
    oe: { id: task.oe.id, name: task.oe.name, active: task.oe.status === 'ACTIVE' },
    technicianType: task.technicianType,
    assetType: toRef(task.assetType),
    activity: { ...task.activity, code: null },
    deviceType: toRef(task.deviceType),
    makeModel: task.makeModel,
    installationType: toRef(task.installationType),
    requestedAt: iso(task.requestedAt),
    fitmentAt: iso(task.fitmentAt),
    shiftType: toRef(task.shiftType),
    issueReported: toRef(task.issueReported),
    gpsAddress: task.gpsAddress,
    comments: task.comments,
    vehicleEntry: task.vehicleEntry,
    counts: countFitments(task.fitments),
    fitments: task.fitments.map((f) => toFitmentDto(f, task, actor)),
    createdBy: task.createdBy,
    createdAt: iso(task.createdAt),
    updatedAt: iso(task.updatedAt),
    completedAt: isoOrNull(task.completedAt),
    permissions: taskPermissions(actor, task),
  };
}
