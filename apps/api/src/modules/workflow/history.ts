import {
  TASK_EVENT_LABELS,
  formatIstDateTime,
  formatOmId,
  formatTkId,
  istFileStamp,
  toCsv,
  type FitmentStatus,
  type ReopenLoopDto,
  type StageStep,
  type StageTimeline,
  type TaskEventDto,
  type TaskEventType,
  type TaskHistoryResponse,
  type UserRef,
} from '@champ/shared';
import { notFound } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { safeText, type ExportFile } from '../tasks/export';

const userRef = { select: { id: true, name: true } } as const;
const ENDED_EARLY: readonly FitmentStatus[] = ['CLOSED_NOT_DONE', 'MOVED_TO_FT'];

async function loadHistory(taskId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      omNo: true,
      deletedAt: true,
      fitments: {
        select: { id: true, tkNo: true, status: true, replacementOfId: true, technicianId: true, technician: userRef },
        orderBy: { seq: 'asc' },
      },
    },
  });
  if (!task || task.deletedAt) throw notFound('Task not found');
  const events = await prisma.taskEvent.findMany({
    where: { taskId },
    include: { actor: userRef, fitment: { select: { id: true, tkNo: true } }, attributions: { include: { user: userRef } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return { task, events };
}
type HistoryEvent = Awaited<ReturnType<typeof loadHistory>>['events'][number];

const at = (e: HistoryEvent) => e.createdAt.toISOString();
const step = (start: HistoryEvent, end?: HistoryEvent | null): StageStep => ({
  at: at(start),
  by: start.actor,
  completedAt: end ? at(end) : null,
  completedBy: end?.actor ?? null,
});
/** A stage that happens at one moment (verification, final approval). */
const moment = (e: HistoryEvent | undefined) => (e ? step(e, e) : null);
const lastOf = (events: HistoryEvent[], type: TaskEventType) => events.findLast((e) => e.type === type);

/**
 * A fitment's stages in its current cycle: first = created (completed when assigned); second = started
 * (completed when submitted); verification = OE verified; final = OM approved. A reopen starts a new cycle,
 * so only the events after the last reopen count for the second, verification and final stages. An undone
 * fault (CR-11) also starts a new cycle: the fitment is Assigned again and the technician starts it afresh.
 */
function fitmentStages(created: HistoryEvent | undefined, events: HistoryEvent[], assigned: boolean): StageTimeline {
  const lastReopen = events.findLastIndex((e) => e.type === 'FITMENT_REOPENED' || e.type === 'FITMENT_FAULT_UNDONE');
  const cycle = events.slice(lastReopen + 1);
  const assignment = assigned ? lastOf(events, 'FITMENT_ASSIGNED') : undefined;
  const start = lastOf(cycle, 'FITMENT_STARTED');
  const submit = start ? cycle.slice(cycle.indexOf(start)).findLast((e) => e.type === 'FITMENT_SUBMITTED') : undefined;
  return {
    // Fitments created already assigned (task created with a technician) complete the first stage at creation.
    first: created ? step(created, assignment ?? (assigned ? created : null)) : null,
    second: start ? step(start, submit) : null,
    verification: moment(lastOf(cycle, 'FITMENT_VERIFIED')),
    final: moment(lastOf(cycle, 'FITMENT_APPROVED')),
  };
}

/**
 * A task stage from its fitments' stages: it starts with the earliest fitment and is complete (with the
 * latest time) once every active fitment (not Closed – not done / Moved to FT) has completed it.
 */
function aggregate(steps: (StageStep | null)[], activeSteps: (StageStep | null)[]): StageStep | null {
  const started = steps.filter((s): s is StageStep => !!s).sort((a, b) => a.at.localeCompare(b.at));
  if (!started.length) return null;
  const done =
    activeSteps.length > 0 && activeSteps.every((s) => s?.completedAt)
      ? (activeSteps as StageStep[]).reduce((a, b) => (a.completedAt! >= b.completedAt! ? a : b))
      : null;
  return { at: started[0]!.at, by: started[0]!.by, completedAt: done?.completedAt ?? null, completedBy: done?.completedBy ?? null };
}

function reopenLoops(events: HistoryEvent[]): ReopenLoopDto[] {
  return events
    .filter((e) => e.type === 'FITMENT_REOPENED')
    .map((e) => ({
      at: at(e),
      by: e.actor,
      fromStatus: e.fromStatus as FitmentStatus,
      reason: String((e.data as { reason?: unknown } | null)?.reason ?? ''),
      attributions: e.attributions.map((a) => ({ user: a.user as UserRef, role: a.role })),
    }));
}

/** `GET /tasks/:id/history` (SA/OM): the stage timeline of the task and of each fitment, with reopen loops. */
export async function getTaskHistory(taskId: string): Promise<TaskHistoryResponse> {
  const { task, events } = await loadHistory(taskId);
  const taskCreated = events.find((e) => e.type === 'TASK_CREATED');
  const fitments = task.fitments.map((f) => {
    const own = events.filter((e) => e.fitmentId === f.id);
    // A replacement starts at its creation (also one unlinked by an undo faulty, CR-11).
    const created = own.find((e) => e.type === 'FITMENT_REPLACEMENT_CREATED') ?? taskCreated;
    return {
      id: f.id,
      tkId: formatTkId(f.tkNo),
      status: f.status,
      technician: f.technician,
      stages: fitmentStages(created, own, !!f.technicianId),
      reopenLoops: reopenLoops(own),
    };
  });
  // Fitments closed as not done or moved to FT stop counting towards the later stages.
  const active = fitments.filter((f) => !ENDED_EARLY.includes(f.status));
  const stage = (key: keyof StageTimeline) =>
    aggregate(
      fitments.map((f) => f.stages[key]),
      active.map((f) => f.stages[key]),
    );
  const first = stage('first');
  return {
    task: {
      first: taskCreated ? { ...(first ?? step(taskCreated)), at: at(taskCreated), by: taskCreated.actor } : first,
      second: stage('second'),
      verification: stage('verification'),
      final: stage('final'),
    },
    fitments,
  };
}

const toEventDto = (e: HistoryEvent): TaskEventDto => ({
  id: e.id,
  at: at(e),
  actor: e.actor,
  fitment: e.fitment && { id: e.fitment.id, tkId: formatTkId(e.fitment.tkNo) },
  type: e.type as TaskEventType,
  fromStatus: e.fromStatus,
  toStatus: e.toStatus,
  data: e.data,
});

/** `GET /tasks/:id/events` (SA/OM): the raw event log, oldest first. */
export async function listTaskEvents(taskId: string): Promise<{ items: TaskEventDto[] }> {
  const { events } = await loadHistory(taskId);
  return { items: events.map(toEventDto) };
}

/** The raw event log as CSV (IST times; `data` as a JSON string). */
export async function exportTaskEvents(taskId: string): Promise<ExportFile> {
  const { task, events } = await loadHistory(taskId);
  const header = ['Time (IST)', 'Actor', 'Fitment', 'Event', 'Type', 'From', 'To', 'Data'];
  const rows = events.map((e) =>
    [
      formatIstDateTime(e.createdAt),
      e.actor.name,
      e.fitment ? formatTkId(e.fitment.tkNo) : '',
      TASK_EVENT_LABELS[e.type as TaskEventType] ?? e.type,
      e.type,
      e.fromStatus ?? '',
      e.toStatus ?? '',
      e.data === null ? '' : JSON.stringify(e.data),
    ].map(safeText),
  );
  return {
    filename: `champ-${formatOmId(task.omNo)}-events-${istFileStamp()}.csv`,
    contentType: 'text/csv; charset=utf-8',
    body: Buffer.from(`\uFEFF${toCsv(header, rows)}`),
  };
}
