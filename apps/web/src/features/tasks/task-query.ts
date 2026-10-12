import { defaultTaskSort, type ExportFormat, type ExportLevel, type TaskSort, type TaskStatus, type TaskView } from '@champ/shared';
import { withQuery } from '@/lib/api';
import type { TaskListParams } from './queries';

/** Open tasks, Assigned (OE), Completed tasks and All tasks (CR-04). */
export type TaskListView = TaskView;

/** The filters of a task table, as the UI holds them ('' or null = not set). */
export interface TaskFilterState {
  q: string;
  clientId: string | null;
  oeId: string | null;
  technicianId: string | null;
  status: TaskStatus | '';
  activityId: string | null;
  /** IST days, `YYYY-MM-DD`, both inclusive. */
  from: string;
  to: string;
  sort: TaskSort;
}

export const EMPTY_FILTERS: TaskFilterState = {
  q: '',
  clientId: null,
  oeId: null,
  technicianId: null,
  status: '',
  activityId: null,
  from: '',
  to: '',
  sort: 'fitmentAt:asc',
};

/** The empty filters of a view, with its default sort (latest completion first for Completed tasks). */
export const emptyFiltersFor = (view: TaskListView): TaskFilterState => ({ ...EMPTY_FILTERS, sort: defaultTaskSort(view) });

/** Whether any filter (other than the sort) is set. */
export const hasFilters = (f: TaskFilterState) =>
  !!(f.q.trim() || f.clientId || f.oeId || f.technicianId || f.status || f.activityId || f.from || f.to);

/** The `GET /tasks` (and export) query for a view and its filters; unset filters are left out. */
export function buildTaskQuery(view: TaskListView, f: TaskFilterState, page?: number, pageSize?: number): TaskListParams {
  const query: TaskListParams = {
    view,
    q: f.q.trim() || undefined,
    clientId: f.clientId ?? undefined,
    oeId: f.oeId ?? undefined,
    technicianId: f.technicianId ?? undefined,
    status: f.status || undefined,
    activityId: f.activityId ?? undefined,
    from: f.from || undefined,
    to: f.to || undefined,
    sort: f.sort,
    page,
    pageSize,
  };
  return Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined));
}

/**
 * The export URL (under `/api`) for the current filters: the same query without paging. `level=fitment` (F06)
 * gives one row per fitment with the verification columns; the task level is the default and left out.
 */
export const exportPath = (view: TaskListView, f: TaskFilterState, format: ExportFormat, level: ExportLevel = 'task') =>
  withQuery('/tasks/export', { ...buildTaskQuery(view, f), format, level: level === 'fitment' ? level : undefined });
