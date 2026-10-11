import {
  canDeleteTask,
  canManageTask,
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

const iso = (d: Date) => d.toISOString();

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
  fitments: { select: { status: true, technicianId: true } },
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
  };
}

// --- Detail ---

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
  fitments: { include: { technician: { select: technicianSelect } }, orderBy: { seq: 'asc' } },
} satisfies Prisma.TaskInclude;
export type TaskDetailRow = Prisma.TaskGetPayload<{ include: typeof taskDetailInclude }>;

type FitmentRow = TaskDetailRow['fitments'][number];

export const toFitmentDto = (f: FitmentRow): FitmentDto => ({
  id: f.id,
  tkId: formatTkId(f.tkNo),
  seq: f.seq,
  status: f.status,
  technician: f.technician,
  vehicleRegNo: f.vehicleRegNo,
  chassisNo: f.chassisNo,
  assetNumber: f.assetNumber,
  oldDeviceId: f.oldDeviceId,
});

/** What the caller may do with the task (spec §3 and the untouched rule). */
export function taskPermissions(actor: User, task: { oeId: string; fitments: readonly { status: FitmentDto['status'] }[] }) {
  const manage = canManageTask(actor, task);
  const untouched = isTaskUntouched(task.fitments);
  return {
    canEdit: manage && untouched,
    canAssign: manage && task.fitments.some((f) => isFitmentAssignable(f.status)),
    canDelete: canDeleteTask(actor) && untouched,
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
    fitments: task.fitments.map(toFitmentDto),
    createdBy: task.createdBy,
    createdAt: iso(task.createdAt),
    updatedAt: iso(task.updatedAt),
    permissions: taskPermissions(actor, task),
  };
}
