import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Download, Loader2, Search, X } from 'lucide-react';
import {
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type ExportFormat,
  type TaskListItemDto,
  type TaskSort,
  type TaskStatus,
} from '@champ/shared';
import { SearchableSelect } from '@/components/searchable-select';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDebounced } from '@/hooks/use-debounced';
import { ApiError } from '@/lib/api';
import { useCurrentUser } from '@/lib/auth';
import { formatIst } from '@/lib/format';
import { useLookups } from '../masters/queries';
import { downloadFile, useTaskOptions, useTasks } from './queries';
import { EMPTY_FILTERS, buildTaskQuery, exportPath, hasFilters, type TaskFilterState, type TaskListView } from './task-query';
import { TaskStatusBadge } from '@/components/fitment-status-badge';

const PAGE_SIZE = 20;
const ALL = 'ALL';

const SORTS: { value: TaskSort; label: string }[] = [
  { value: 'fitmentAt:asc', label: 'Fitment date (soonest first)' },
  { value: 'fitmentAt:desc', label: 'Fitment date (latest first)' },
  { value: 'createdAt:desc', label: 'Newest first' },
  { value: 'createdAt:asc', label: 'Oldest first' },
];

const fitmentsLabel = (t: TaskListItemDto) => `${t.fitments.assigned}/${t.fitments.total}`;

/**
 * The task list shared by Open tasks and Assigned: filters, id search, sorting, paging and a Download menu
 * (CSV / Excel with the current filters). A table on md+ and cards on phones.
 */
export function TaskTable({ view }: { view: TaskListView }) {
  const actor = useCurrentUser();
  const [filters, setFilters] = useState<TaskFilterState>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [downloading, setDownloading] = useState<ExportFormat | null>(null);
  const q = useDebounced(filters.q);
  const effective = { ...filters, q };
  const lookups = useLookups();
  const options = useTaskOptions();
  const { data, isPending, isError } = useTasks(buildTaskQuery(view, effective, page, PAGE_SIZE));
  const tasks = data?.items ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const update = <K extends keyof TaskFilterState>(key: K, value: TaskFilterState[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const assetName = (id: string) => lookups.data?.assetTypes.find((a) => a.id === id)?.name;
  const statuses = TASK_STATUSES.filter((s) => view !== 'open' || s !== 'COMPLETED');
  // An OE has the Assigned view for their own tasks, so the OE filter is for SA/OM/RO.
  const showOeFilter = actor.role !== 'OE';

  const download = async (format: ExportFormat) => {
    setDownloading(format);
    try {
      await downloadFile(exportPath(view, effective, format), `champ-tasks.${format}`);
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
              <DropdownMenuItem onSelect={() => void download('csv')}>CSV</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void download('xlsx')}>Excel (.xlsx)</DropdownMenuItem>
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
        <Select value={filters.sort} onValueChange={(v) => update('sort', v as TaskSort)}>
          <SelectTrigger aria-label="Sort" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="grid min-w-0 grid-cols-1 gap-1">
          <Label htmlFor={`${view}-from`} className="text-xs text-muted-foreground">
            Fitment from
          </Label>
          <Input id={`${view}-from`} type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => update('from', e.target.value)} />
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-1">
          <Label htmlFor={`${view}-to`} className="text-xs text-muted-foreground">
            Fitment to
          </Label>
          <Input id={`${view}-to`} type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => update('to', e.target.value)} />
        </div>
      </div>

      {isPending ? (
        <div className="grid grid-cols-1 gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : isError ? (
        <p className="py-8 text-center text-sm text-destructive">Could not load tasks.</p>
      ) : tasks.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No tasks found.</p>
      ) : (
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
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

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
