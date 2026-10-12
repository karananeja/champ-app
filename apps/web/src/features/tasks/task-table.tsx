import { useState, type ComponentProps } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Download, Loader2, Plus, Search, X } from 'lucide-react';
import {
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type ExportFormat,
  type ExportLevel,
  type TaskListItemDto,
  type TaskSort,
  type TaskStatus,
} from '@champ/shared';
import { DateRangePicker } from '@/components/date-picker';
import { ListStates } from '@/components/list-states';
import { SearchableSelect } from '@/components/searchable-select';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDebounced } from '@/hooks/use-debounced';
import { ApiError } from '@/lib/api';
import { useCurrentUser } from '@/lib/auth';
import { formatIst } from '@/lib/format';
import { useLookups } from '../masters/queries';
import { downloadFile, useTaskOptions, useTasks } from './queries';
import { EMPTY_FILTERS, buildTaskQuery, emptyFiltersFor, exportPath, hasFilters, type TaskFilterState, type TaskListView } from './task-query';
import { TaskStatusBadge } from '@/components/fitment-status-badge';
import { canCreateTask } from '@/lib/permissions';

const PAGE_SIZE = 20;
const ALL = 'ALL';

const COMPLETION_SORTS: { value: TaskSort; label: string }[] = [
  { value: 'completedAt:desc', label: 'Completed (latest first)' },
  { value: 'completedAt:asc', label: 'Completed (oldest first)' },
];

const SORTS: { value: TaskSort; label: string }[] = [
  { value: 'fitmentAt:asc', label: 'Fitment date (soonest first)' },
  { value: 'fitmentAt:desc', label: 'Fitment date (latest first)' },
  { value: 'createdAt:desc', label: 'Newest first' },
  { value: 'createdAt:asc', label: 'Oldest first' },
];

const createAction = (
  <Button asChild>
    <Link to="/tasks/new">
      <Plus /> Create task
    </Link>
  </Button>
);

/** The empty state of each view when nothing exists yet (CR-03); creators get a Create task button. */
const EMPTY_COPY: Record<TaskListView, (creator: boolean) => ComponentProps<typeof ListStates>['empty']> = {
  open: (creator) => ({
    illustration: 'tasks-empty',
    title: 'No open tasks',
    description: 'Every task is finished, or none has been created yet.',
    action: creator && createAction,
  }),
  assigned: (creator) => ({
    illustration: 'tasks-empty',
    title: 'No tasks assigned to you',
    description: 'Tasks where you are the operation executive show here.',
    action: creator && createAction,
  }),
  completed: () => ({
    illustration: 'all-done',
    title: 'No completed tasks yet',
    description: 'A task shows here once all its fitments are final-approved, closed or moved to FT.',
  }),
  all: (creator) => ({
    illustration: 'tasks-empty',
    title: 'No tasks yet',
    description: 'Create a task, or upload many at once from a CSV.',
    action: creator && createAction,
  }),
};

const fitmentsLabel = (t: TaskListItemDto) => `${t.fitments.assigned}/${t.fitments.total}`;

/** F06: billable of the verified fitments, "3 / 5"; "—" while none is verified. */
const billableText = (t: TaskListItemDto) => (t.verifiedCount ? `${t.billableCount} / ${t.verifiedCount}` : '—');

/**
 * The task list shared by Open tasks, Assigned, Completed tasks and All tasks (CR-04): filters, id search, sorting, paging and a Download menu
 * (CSV / Excel with the current filters). A table on md+ and cards on phones.
 */
export function TaskTable({ view }: { view: TaskListView }) {
  const actor = useCurrentUser();
  const [filters, setFilters] = useState<TaskFilterState>(() => emptyFiltersFor(view));
  const [page, setPage] = useState(1);
  const [downloading, setDownloading] = useState<ExportFormat | null>(null);
  // F06: the Billable column, for finished work (Completed and All tasks).
  const showBillable = view === 'completed' || view === 'all';
  const q = useDebounced(filters.q);
  const effective = { ...filters, q };
  const lookups = useLookups();
  const options = useTaskOptions();
  const { data, isPending, isError, error, refetch } = useTasks(buildTaskQuery(view, effective, page, PAGE_SIZE));
  const tasks = data?.items ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const update = <K extends keyof TaskFilterState>(key: K, value: TaskFilterState[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const assetName = (id: string) => lookups.data?.assetTypes.find((a) => a.id === id)?.name;
  // Open leaves Completed out; Completed tasks are all Completed (no status filter); All offers every status.
  const statuses = TASK_STATUSES.filter((s) => view !== 'open' || s !== 'COMPLETED');
  const showStatusFilter = view !== 'completed';
  const sorts = view === 'completed' || view === 'all' ? [...COMPLETION_SORTS, ...SORTS] : SORTS;
  // An OE has the Assigned view for their own tasks, so the OE filter is for SA/OM/RO.
  const showOeFilter = actor.role !== 'OE';

  const download = async (format: ExportFormat, level: ExportLevel = 'task') => {
    setDownloading(format);
    try {
      await downloadFile(exportPath(view, effective, format, level), `champ-${level === 'fitment' ? 'fitments' : 'tasks'}.${format}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not download the tasks');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
        <div className="relative sm:flex-1">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search OM/OE/TK id, customer or POC"
            aria-label="Search tasks"
            value={filters.q}
            onChange={(e) => update('q', e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="flex gap-2">
          {hasFilters(filters) && (
            <Button
              variant="ghost"
              onClick={() => {
                setFilters({ ...EMPTY_FILTERS, sort: filters.sort });
                setPage(1);
              }}
            >
              <X /> Clear filters
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" disabled={!!downloading} className="flex-1 sm:flex-none">
                {downloading ? <Loader2 className="animate-spin" /> : <Download />} Download
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="text-xs text-muted-foreground">One row per task</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => void download('csv')}>CSV</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void download('xlsx')}>Excel (.xlsx)</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground">One row per fitment</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => void download('csv', 'fitment')}>Fitments (CSV)</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void download('xlsx', 'fitment')}>Fitments (Excel)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <SearchableSelect
          aria-label="Filter by customer"
          className="col-span-2 lg:col-span-1"
          value={filters.clientId}
          onChange={(v) => update('clientId', v)}
          options={(lookups.data?.clients ?? []).map((c) => ({ value: c.id, label: c.name, hint: c.code ?? undefined }))}
          clearLabel="All customers"
          searchPlaceholder="Search customer"
        />
        {showOeFilter && (
          <SearchableSelect
            aria-label="Filter by OE"
            className="col-span-2 lg:col-span-1"
            value={filters.oeId}
            onChange={(v) => update('oeId', v)}
            options={(options.data?.oes ?? []).map((o) => ({ value: o.id, label: o.name }))}
            clearLabel="All OEs"
            searchPlaceholder="Search OE"
          />
        )}
        <SearchableSelect
          aria-label="Filter by technician"
          className="col-span-2 lg:col-span-1"
          value={filters.technicianId}
          onChange={(v) => update('technicianId', v)}
          options={(options.data?.technicians ?? []).map((t) => ({ value: t.id, label: t.name, hint: t.baseLocation ?? undefined }))}
          clearLabel="All technicians"
          searchPlaceholder="Search technician"
        />
        <SearchableSelect
          aria-label="Filter by activity"
          className="col-span-2 lg:col-span-1"
          value={filters.activityId}
          onChange={(v) => update('activityId', v)}
          options={(lookups.data?.activities ?? []).map((a) => ({ value: a.id, label: a.name, hint: assetName(a.assetTypeId) }))}
          clearLabel="All activities"
          searchPlaceholder="Search activity"
        />
        {showStatusFilter && (
          <Select value={filters.status || ALL} onValueChange={(v) => update('status', v === ALL ? '' : (v as TaskStatus))}>
            <SelectTrigger aria-label="Filter by status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {statuses.map((s) => (
                <SelectItem key={s} value={s}>
                  {TASK_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={filters.sort} onValueChange={(v) => update('sort', v as TaskSort)}>
          <SelectTrigger aria-label="Sort" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sorts.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DateRangePicker
          aria-label="Filter by fitment date"
          className="col-span-2 lg:col-span-1"
          placeholder="Any fitment date"
          value={{ from: filters.from, to: filters.to }}
          onChange={({ from, to }) => {
            setFilters((prev) => ({ ...prev, from, to }));
            setPage(1);
          }}
        />
      </div>

      <ListStates
        isPending={isPending}
        isError={isError}
        error={error}
        onRetry={() => void refetch()}
        isEmpty={tasks.length === 0}
        filtered={hasFilters(filters)}
        onClearFilters={() => {
          setFilters({ ...EMPTY_FILTERS, sort: filters.sort });
          setPage(1);
        }}
        noMatches={{ title: 'No tasks match', description: 'Nothing matches your search or filters. Try other words, or clear the filters.' }}
        empty={EMPTY_COPY[view](canCreateTask(actor))}
      >
        <>
          <div className="hidden rounded-md border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Customer / site</TableHead>
                  <TableHead>Activity</TableHead>
                  <TableHead>OE</TableHead>
                  <TableHead>Assigned / vehicles</TableHead>
                  <TableHead>Fitment (IST)</TableHead>
                  {showBillable && <TableHead title="Billable of the verified fitments">Billable</TableHead>}
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((t) => (
                  <TableRow key={t.id} data-testid="task-row">
                    <TableCell className="font-medium">
                      <Link to={`/tasks/${t.id}`} className="font-mono hover:underline">
                        {t.omId}
                      </Link>
                      <div className="font-mono text-xs text-muted-foreground">{t.oeTaskId}</div>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {t.client.name}
                      <div className="text-xs text-muted-foreground">
                        {t.site.name} · {t.city}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {t.activity.name}
                      <div className="text-xs text-muted-foreground">{t.assetType.name}</div>
                    </TableCell>
                    <TableCell className="whitespace-normal">{t.oe.name}</TableCell>
                    <TableCell data-testid="task-fitments">
                      {fitmentsLabel(t)}
                      {t.fitments.open > 0 && <div className="text-xs text-muted-foreground">{t.fitments.open} open</div>}
                    </TableCell>
                    <TableCell>{formatIst(t.fitmentAt)}</TableCell>
                    {showBillable && <TableCell data-testid="task-billable">{billableText(t)}</TableCell>}
                    <TableCell>
                      <TaskStatusBadge status={t.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="grid grid-cols-1 gap-2 md:hidden">
            {tasks.map((t) => (
              <li key={t.id} data-testid="task-card" className="rounded-md border">
                <Link to={`/tasks/${t.id}`} className="block p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-mono font-medium">{t.omId}</div>
                      <div className="font-mono text-xs text-muted-foreground">{t.oeTaskId}</div>
                    </div>
                    <TaskStatusBadge status={t.status} />
                  </div>
                  <div className="mt-2 text-sm break-words">
                    {t.client.name} · {t.site.name}, {t.city}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {t.activity.name} ({t.assetType.name}) · {t.oe.name}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-sm">
                    <span>
                      Assigned <span data-testid="task-fitments">{fitmentsLabel(t)}</span>
                    </span>
                    <span className="text-muted-foreground">{formatIst(t.fitmentAt)}</span>
                    {showBillable && (
                      <span>
                        Billable <span data-testid="task-billable">{billableText(t)}</span>
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      </ListStates>

      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>
            Page {page} of {totalPages} · {data.total} tasks
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft /> Prev
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
