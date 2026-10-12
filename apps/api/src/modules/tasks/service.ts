import {
  canCreateTask,
  canDeleteTask,
  canEditFitmentData,
  canManageTask,
  formatOmId,
  formatTkId,
  isFitmentAssignable,
  isPostApprovalEdit,
  isTaskUntouched,
  statusAfterAssignment,
  type AssignFitmentsInput,
  type CreateTaskInput,
  type ListTasksQuery,
  type Paginated,
  type TaskDto,
  type TaskListItemDto,
  type TaskOptionsResponse,
  type UpdateFitmentInput,
  type UpdateTaskInput,
  type VehicleRowInput,
} from '@champ/shared';
import type { Prisma } from '../../generated/prisma/client';
import { nextNumber } from '../../lib/counters';
import { badRequest, forbidden, notFound } from '../../lib/errors';
import { prisma, type User } from '../../lib/prisma';
import { taskDetailInclude, taskListInclude, toTaskDto, toTaskListItem } from './dto';
import { diffOf, writeEvents } from './events';
import { taskOrderBy, taskWhere } from './filters';
import { operationTaskType, requireTechnician, validateTaskRefs, type TaskRefValues } from './refs';
import {
  assertUntouched,
  assignmentStatus,
  fitmentDataLocked,
  fitmentLocked,
  lockTask,
  recomputeTaskStatus,
} from './status';

type Tx = Prisma.TransactionClient;

/** A task that isn't deleted, with everything the detail needs, or 404. */
export async function loadTask(id: string, db: Tx = prisma) {
  const task = await db.task.findUnique({ where: { id }, include: taskDetailInclude });
  if (!task || task.deletedAt) throw notFound('Task not found');
  return task;
}

/** Loads a task the actor may edit/assign (canManageTask), or throws 404/403. */
async function loadManagedTask(actor: User, id: string) {
  const task = await loadTask(id);
  if (!canManageTask(actor, task)) throw forbidden();
  return task;
}

// --- Read ---

export async function getTask(actor: User, id: string): Promise<TaskDto> {
  return toTaskDto(await loadTask(id), actor);
}

export async function listTasks(actor: User, query: ListTasksQuery): Promise<Paginated<TaskListItemDto>> {
  const where = taskWhere(actor, query);
  // Not a batch transaction: inside one, Prisma runs the relation queries concurrently on a single pg
  // connection, which pg deprecates.
  const [total, tasks] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where,
      include: taskListInclude,
      orderBy: taskOrderBy(query),
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return { items: tasks.map(toTaskListItem), total, page: query.page, pageSize: query.pageSize };
}

/** People the task form and the task filters offer: active OEs (an OE gets only themselves) and OTs. */
export async function getTaskOptions(actor: User): Promise<TaskOptionsResponse> {
  const [oes, technicians] = await Promise.all([
    actor.role === 'OE'
      ? [{ id: actor.id, name: actor.name }]
      : prisma.user.findMany({
          where: { role: 'OE', status: 'ACTIVE' },
          select: { id: true, name: true },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        }),
    prisma.user.findMany({
      where: { role: 'OT', status: 'ACTIVE' },
      select: { id: true, name: true, technicianType: true, baseLocation: { select: { city: true } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    }),
  ]);
  return {
    oes,
    technicians: technicians.map((t) => ({
      id: t.id,
      name: t.name,
      technicianType: t.technicianType,
      baseLocation: t.baseLocation?.city ?? null,
    })),
  };
}

// --- Create ---

const refValuesOf = (input: CreateTaskInput | TaskRefValues): TaskRefValues => ({
  clientId: input.clientId,
  siteId: input.siteId,
  oeId: input.oeId,
  technicianType: input.technicianType ?? null,
  assetTypeId: input.assetTypeId,
  activityId: input.activityId,
  deviceTypeId: input.deviceTypeId,
  makeModelId: input.makeModelId ?? null,
  installationTypeId: input.installationTypeId,
  shiftTypeId: input.shiftTypeId,
  issueReportedId: input.issueReportedId,
});

/**
 * Creates a task with one fitment per vehicle (D-009), its OM/OE/TK numbers and a TASK_CREATED event, in
 * one transaction. With a technician, every fitment starts Assigned to them (D-063); otherwise Open.
 */
export async function createTask(actor: User, input: CreateTaskInput): Promise<TaskDto> {
  if (!canCreateTask(actor)) throw forbidden();
  const refs = refValuesOf(input);
  const { locationId } = await validateTaskRefs(actor, refs);
  const technician = input.technicianId ? await requireTechnician(input.technicianId, refs.technicianType) : null;
  if (technician && !refs.technicianType) refs.technicianType = technician.technicianType;
  const taskType = await operationTaskType();

  const vehicles: Partial<VehicleRowInput>[] =
    input.vehicles.entry === 'COUNT' ? Array.from({ length: input.vehicles.count }, () => ({})) : input.vehicles.rows;
  const technicianId = technician?.id ?? null;
  const status = assignmentStatus(technicianId);

  const id = await prisma.$transaction(async (tx) => {
    const omNo = await nextNumber(tx, 'OM');
    const oeNo = await nextNumber(tx, 'OE');
    const firstTk = await nextNumber(tx, 'TK', vehicles.length);
    const task = await tx.task.create({
      data: {
        omNo,
        oeNo,
        taskTypeId: taskType.id,
        ...refs,
        locationId,
        pocName: input.pocName,
        pocPhone: input.pocPhone,
        pocEmail: input.pocEmail ?? null,
        requestedAt: new Date(input.requestedAt),
        fitmentAt: new Date(input.fitmentAt),
        gpsAddress: input.gpsAddress ?? null,
        comments: input.comments ?? null,
        vehicleEntry: input.vehicles.entry,
        createdById: actor.id,
        fitments: {
          createMany: {
            data: vehicles.map((v, i) => ({
              tkNo: firstTk + i,
              seq: i + 1,
              status,
              technicianId,
              vehicleRegNo: v.vehicleRegNo ?? null,
              chassisNo: v.chassisNo ?? null,
              assetNumber: v.assetNumber ?? null,
              oldDeviceId: v.oldDeviceId ?? null,
            })),
          },
        },
      },
    });
    const taskStatus = await recomputeTaskStatus(tx, task.id);
    await writeEvents(tx, actor, [
      {
        taskId: task.id,
        type: 'TASK_CREATED',
        toStatus: taskStatus,
        data: { omId: formatOmId(omNo), vehicles: vehicles.length, entry: input.vehicles.entry, technicianId },
      },
    ]);
    return task.id;
  });
  return getTask(actor, id);
}

// --- Edit ---

/** An OE may edit the header only while the task is untouched; SA and OM at any stage (F05). */
const headerEditNeedsUntouched = (actor: User) => actor.role === 'OE';

/**
 * Edits header fields (not vehicles). An OE only while the task is untouched; SA/OM at any stage, and an edit
 * after work started is flagged `postStart: true` (F05). Changed references must be active; unchanged ones
 * may have been deactivated since. Make/model is cleared when the asset type stops being a vehicle. The
 * TASK_UPDATED event carries the diff.
 */
export async function updateTask(actor: User, id: string, input: UpdateTaskInput): Promise<TaskDto> {
  const task = await loadManagedTask(actor, id);
  if (headerEditNeedsUntouched(actor)) assertUntouched(task.fitments);

  const previous = refValuesOf(task);
  const merged: TaskRefValues = { ...previous };
  for (const key of Object.keys(previous) as (keyof TaskRefValues)[]) {
    const value = input[key];
    if (value !== undefined) (merged as unknown as Record<string, unknown>)[key] = value;
  }
  if (input.makeModelId === undefined && merged.assetTypeId !== previous.assetTypeId) {
    const assetType = await prisma.lookupItem.findUnique({ where: { id: merged.assetTypeId } });
    if (assetType?.code !== 'VEHICLE') merged.makeModelId = null;
  }
  const { locationId } = await validateTaskRefs(actor, merged, previous);

  const next: Record<string, unknown> = { ...merged, locationId };
  if (input.pocName !== undefined) next.pocName = input.pocName;
  if (input.pocPhone !== undefined) next.pocPhone = input.pocPhone;
  if (input.pocEmail !== undefined) next.pocEmail = input.pocEmail;
  if (input.requestedAt !== undefined) next.requestedAt = new Date(input.requestedAt);
  if (input.fitmentAt !== undefined) next.fitmentAt = new Date(input.fitmentAt);
  if (input.gpsAddress !== undefined) next.gpsAddress = input.gpsAddress;
  if (input.comments !== undefined) next.comments = input.comments;

  const diff = diffOf(task as unknown as Record<string, unknown>, next);
  if (Object.keys(diff).length === 0) return toTaskDto(task, actor);

  const data = Object.fromEntries(Object.keys(diff).map((key) => [key, next[key]])) as Prisma.TaskUncheckedUpdateInput;
  await prisma.$transaction(async (tx) => {
    await lockTask(tx, id);
    const fitments = await tx.fitment.findMany({ where: { taskId: id }, select: { status: true } });
    if (headerEditNeedsUntouched(actor)) assertUntouched(fitments);
    const postStart = !isTaskUntouched(fitments);
    await tx.task.update({ where: { id }, data });
    await writeEvents(tx, actor, [
      { taskId: id, type: 'TASK_UPDATED', data: { ...diff, ...(postStart && { postStart: true }) } as Prisma.InputJsonValue },
    ]);
  });
  return getTask(actor, id);
}

/**
 * Edits one fitment's data (vehicle details in F05; the OE verification fields come in F06) under the edit
 * locks of the shared `canEditFitmentData` (F05): the task's OE until OM approval, SA/OM at any stage. An
 * edit of an OM-approved fitment is flagged `postApproval: true`.
 */
export async function updateFitment(actor: User, taskId: string, fitmentId: string, input: UpdateFitmentInput) {
  const task = await loadManagedTask(actor, taskId);
  const fitment = task.fitments.find((f) => f.id === fitmentId);
  if (!fitment) throw notFound('Fitment not found');

  const next = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  await prisma.$transaction(async (tx) => {
    await lockTask(tx, taskId);
    const current = await tx.fitment.findUniqueOrThrow({ where: { id: fitmentId } });
    if (!canEditFitmentData(actor, { task, fitment: current })) {
      throw fitmentDataLocked(formatTkId(current.tkNo), current.status);
    }
    const diff = diffOf(current as unknown as Record<string, unknown>, next);
    if (Object.keys(diff).length === 0) return;
    await tx.fitment.update({ where: { id: fitmentId }, data: next });
    const postApproval = isPostApprovalEdit(current.status);
    await writeEvents(tx, actor, [
      {
        taskId,
        fitmentId,
        type: 'FITMENT_UPDATED',
        data: { ...diff, ...(postApproval && { postApproval: true }) } as Prisma.InputJsonValue,
      },
    ]);
  });
  return getTask(actor, taskId);
}

// --- Assign ---

/**
 * Assigns (or, with `technicianId: null`, unassigns) fitments of one task, all or nothing: any fitment
 * that isn't Open, Assigned or Reopened makes the whole request fail with 409 FITMENT_LOCKED. Any active OT
 * can be chosen (D-063). A Reopened fitment stays Reopened when (re)assigned and becomes Open when
 * unassigned (F05, D-075). One event per changed fitment, then the task status is recomputed.
 */
export async function assignFitments(actor: User, taskId: string, input: AssignFitmentsInput): Promise<TaskDto> {
  await loadManagedTask(actor, taskId);
  const technician = input.technicianId ? await requireTechnician(input.technicianId) : null;
  const technicianId = technician?.id ?? null;
  const ids = [...new Set(input.fitmentIds)];

  await prisma.$transaction(async (tx) => {
    await lockTask(tx, taskId);
    const fitments = await tx.fitment.findMany({ where: { id: { in: ids }, taskId }, orderBy: { seq: 'asc' } });
    if (fitments.length !== ids.length) {
      throw badRequest('INVALID_REFERENCE', 'Some of the chosen fitments are not part of this task', {
        fieldErrors: { fitmentIds: ['Not a fitment of this task'] },
      });
    }
    const locked = fitments.find((f) => !isFitmentAssignable(f.status));
    if (locked) throw fitmentLocked(formatTkId(locked.tkNo));

    const changed = fitments
      .map((f) => ({ f, toStatus: statusAfterAssignment(f.status, technicianId) }))
      .filter(({ f, toStatus }) => f.technicianId !== technicianId || f.status !== toStatus);
    if (changed.length === 0) return;
    for (const toStatus of new Set(changed.map((c) => c.toStatus))) {
      await tx.fitment.updateMany({
        where: { id: { in: changed.filter((c) => c.toStatus === toStatus).map((c) => c.f.id) } },
        data: { technicianId, status: toStatus },
      });
    }
    await writeEvents(
      tx,
      actor,
      changed.map(({ f, toStatus }) => ({
        taskId,
        fitmentId: f.id,
        type: technicianId ? 'FITMENT_ASSIGNED' : 'FITMENT_UNASSIGNED',
        fromStatus: f.status,
        toStatus,
        data: { tkId: formatTkId(f.tkNo), technicianId, previousTechnicianId: f.technicianId },
      })),
    );
    await recomputeTaskStatus(tx, taskId);
  });
  return getTask(actor, taskId);
}

// --- Delete ---

/** Soft-deletes an untouched task (SA/OM only) and records TASK_DELETED. */
export async function deleteTask(actor: User, id: string): Promise<void> {
  if (!canDeleteTask(actor)) throw forbidden();
  const task = await loadTask(id);
  assertUntouched(task.fitments);
  await prisma.$transaction(async (tx) => {
    await lockTask(tx, id);
    const current = await tx.task.findUniqueOrThrow({ where: { id }, include: { fitments: { select: { status: true } } } });
    if (current.deletedAt) throw notFound('Task not found');
    assertUntouched(current.fitments);
    await tx.task.update({ where: { id }, data: { deletedAt: new Date(), deletedById: actor.id } });
    await writeEvents(tx, actor, [
      { taskId: id, type: 'TASK_DELETED', fromStatus: current.status, data: { omId: formatOmId(current.omNo) } },
    ]);
  });
}
