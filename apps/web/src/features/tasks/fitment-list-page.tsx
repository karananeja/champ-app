import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { CheckCheck, ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';
import type { WorkflowFitmentItemDto } from '@champ/shared';
import { FitmentStatusBadge } from '@/components/fitment-status-badge';
import { SearchableSelect } from '@/components/SearchableSelect';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ApiError } from '@/lib/api';
import { useCurrentUser } from '@/lib/auth';
import { formatIst } from '@/lib/format';
import { useLookups } from '../masters/queries';
import { useApproveFitments, useTaskOptions, useWorkflowList, type TaskListParams, type WorkflowListName } from './queries';

const PAGE_SIZE = 20;

interface Column {
  header: string;
  cell: (item: WorkflowFitmentItemDto) => ReactNode;
}

interface ListConfig {
  title: string;
  description: string;
  /** Label of the date the from/to filter applies to. */
  dateLabel: string;
  empty: string;
  columns: Column[];
  /** Re-opened only: a "currently reopened" toggle. */
  currentFilter?: boolean;
  /** Awaiting approval only: multi-select with bulk final approve. */
  bulkApprove?: boolean;
}

const who = (u: { name: string } | null) => u?.name ?? '—';
const when = (iso: string | null, by?: { name: string } | null) =>
  iso ? (
    <>
      {formatIst(iso)}
      {by && <div className="text-xs text-muted-foreground">{by.name}</div>}
    </>
  ) : (
    '—'
  );

const taskLink = (i: WorkflowFitmentItemDto) => (
  <Link to={`/tasks/${i.task.id}`} className="font-mono hover:underline">
    {i.task.omId}
  </Link>
);
const customer = (i: WorkflowFitmentItemDto) => (
  <>
    {i.client.name}
    <div className="text-xs text-muted-foreground">{i.site.name}</div>
  </>
);

const COMMON: Column[] = [
  { header: 'Task', cell: taskLink },
  { header: 'Customer', cell: customer },
  { header: 'Technician', cell: (i) => who(i.technician) },
  { header: 'OE', cell: (i) => who(i.oe) },
];

const LISTS: Record<WorkflowListName, ListConfig> = {
  'awaiting-approval': {
    title: 'Awaiting approval',
    description: 'Fitments the OE has verified, waiting for final approval.',
    dateLabel: 'Verified',
    empty: 'Nothing is waiting for final approval.',
    bulkApprove: true,
    columns: [...COMMON, { header: 'Verified (IST)', cell: (i) => when(i.verifiedAt, i.verifiedBy) }],
  },
  reopened: {
    title: 'Re-opened',
    description: 'Fitments sent back for rework, with how often and why.',
    dateLabel: 'Reopened',
    empty: 'No fitment has been reopened.',
    currentFilter: true,
    columns: [
      ...COMMON,
      {
        header: 'Reopens',
        cell: (i) => (
          <Badge variant="outline" className="border-orange-200 bg-orange-50 text-orange-800" data-testid="reopen-count">
            {i.reopenCount}
          </Badge>
        ),
      },
      { header: 'Latest reason', cell: (i) => <span className="break-words">{i.lastReopenReason ?? '—'}</span> },
      { header: 'Last reopened (IST)', cell: (i) => when(i.lastReopenedAt, i.lastReopenedBy) },
      { header: 'Status', cell: (i) => <FitmentStatusBadge status={i.status} /> },
    ],
  },
  faulty: {
    title: 'Faulty tasks',
    description: 'Fitments moved to FT because of a faulty device, and their replacements.',
    dateLabel: 'Moved to FT',
    empty: 'No fitment has been moved to FT.',
    columns: [
      ...COMMON.filter((c) => c.header !== 'OE'),
      { header: 'Fault reason', cell: (i) => <span className="break-words">{i.faultReason ?? '—'}</span> },
      { header: 'Moved to FT (IST)', cell: (i) => when(i.faultyAt) },
      {
        header: 'Replacement',
        cell: (i) =>
          i.replacement ? (
            <div className="grid gap-1" data-testid="replacement">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{i.replacement.tkId}</span>
                <FitmentStatusBadge status={i.replacement.status} />
              </span>
              <span className="text-xs text-muted-foreground">{i.replacement.technician?.name ?? 'Not assigned'}</span>
            </div>
          ) : (
            '—'
          ),
      },
    ],
  },
};

interface Filters {
  clientId: string | null;
  oeId: string | null;
  technicianId: string | null;
  from: string;
  to: string;
  current: boolean;
}
const EMPTY: Filters = { clientId: null, oeId: null, technicianId: null, from: '', to: '', current: false };

/** The list query; unset filters are left out. */
function buildWorkflowQuery(f: Filters, page: number, pageSize = PAGE_SIZE): TaskListParams {
  const query: TaskListParams = {
    clientId: f.clientId ?? undefined,
    oeId: f.oeId ?? undefined,
    technicianId: f.technicianId ?? undefined,
    from: f.from || undefined,
    to: f.to || undefined,
    current: f.current ? 'true' : undefined,
    page,
    pageSize,
  };
  return Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined));
}

/**
 * `/tasks/awaiting-approval`, `/tasks/reopened` and `/tasks/faulty` (F05): fitment lists with customer, OE,
 * technician and date filters, links to the task, paging, a table on md+ and cards on phones. Awaiting
 * approval adds multi-select with bulk final approve.
 */
export function FitmentListPage({ list }: { list: WorkflowListName }) {
  const config = LISTS[list];
  const actor = useCurrentUser();
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const lookups = useLookups();
  const options = useTaskOptions();
  const approve = useApproveFitments();
  const { data, isPending, isError } = useWorkflowList(list, buildWorkflowQuery(filters, page));
  const items = data?.items ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const hasFilters = !!(filters.clientId || filters.oeId || filters.technicianId || filters.from || filters.to || filters.current);
  const chosen = items.filter((i) => selected.has(i.id));

  const update = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const runApprove = () =>
    approve.mutate(
      chosen.map((i) => i.id),
      {
        onSuccess: ({ approved, failed }) => {
          if (approved.length) toast.success(`Final-approved ${approved.length} fitment(s)`);
          for (const f of failed) toast.error(`${f.tkId}: ${f.message}`);
          setSelected(new Set());
          setConfirm(false);
        },
        onError: (err) => {
          toast.error(err instanceof ApiError ? err.message : 'Could not approve the fitments');
          setConfirm(false);
        },
      },
    );

  const checkbox = (i: WorkflowFitmentItemDto) => (
    <Checkbox aria-label={`Select ${i.tkId}`} checked={selected.has(i.id)} onCheckedChange={(v) => toggle(i.id, v === true)} />
  );

  return (
    <div className="grid grid-cols-1 gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{config.title}</h1>
        <p className="text-sm text-muted-foreground">{config.description}</p>
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
        {actor.role !== 'OE' && (
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
        {config.currentFilter && (
          <label className="col-span-2 flex items-center gap-2 text-sm lg:col-span-1">
            <Checkbox checked={filters.current} onCheckedChange={(v) => update('current', v === true)} aria-label="Only currently reopened" />
            Only currently reopened
          </label>
        )}
        <div className="grid min-w-0 grid-cols-1 gap-1">
          <Label htmlFor={`${list}-from`} className="text-xs text-muted-foreground">
            {config.dateLabel} from
          </Label>
          <Input id={`${list}-from`} type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => update('from', e.target.value)} />
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-1">
          <Label htmlFor={`${list}-to`} className="text-xs text-muted-foreground">
            {config.dateLabel} to
          </Label>
          <Input id={`${list}-to`} type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => update('to', e.target.value)} />
        </div>
        {hasFilters && (
          <Button
            variant="ghost"
            className="col-span-2 justify-self-start lg:col-span-1 lg:self-end"
            onClick={() => {
              setFilters(EMPTY);
              setPage(1);
            }}
          >
            <X /> Clear filters
          </Button>
        )}
      </div>

      {config.bulkApprove && items.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/40 p-3">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              aria-label="Select all fitments"
              checked={chosen.length > 0 && chosen.length === items.length ? true : chosen.length > 0 ? 'indeterminate' : false}
              onCheckedChange={(v) => setSelected(v === true ? new Set(items.map((i) => i.id)) : new Set())}
            />
            <span data-testid="selected-count">{chosen.length} selected</span>
          </label>
          <Button disabled={!chosen.length || approve.isPending} onClick={() => setConfirm(true)}>
            {approve.isPending ? <Loader2 className="animate-spin" /> : <CheckCheck />} Final approve
            {chosen.length ? ` (${chosen.length})` : ''}
          </Button>
        </div>
      )}

      {isPending ? (
        <div className="grid grid-cols-1 gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : isError ? (
        <p className="py-8 text-center text-sm text-destructive">Could not load the fitments.</p>
      ) : items.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{config.empty}</p>
      ) : (
        <>
          <div className="hidden rounded-md border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  {config.bulkApprove && (
                    <TableHead className="w-10">
                      <span className="sr-only">Select</span>
                    </TableHead>
                  )}
                  <TableHead>TK id</TableHead>
                  {config.columns.map((c) => (
                    <TableHead key={c.header}>{c.header}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((i) => (
                  <TableRow key={i.id} data-testid="fitment-list-row">
                    {config.bulkApprove && <TableCell>{checkbox(i)}</TableCell>}
                    <TableCell className="font-mono font-medium">{i.tkId}</TableCell>
                    {config.columns.map((c) => (
                      <TableCell key={c.header} className="whitespace-normal">
                        {c.cell(i)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="grid grid-cols-1 gap-2 md:hidden">
            {items.map((i) => (
              <li key={i.id} data-testid="fitment-list-card" className="flex items-start gap-3 rounded-md border p-3">
                {config.bulkApprove && <div className="pt-0.5">{checkbox(i)}</div>}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono font-medium">{i.tkId}</span>
                    <FitmentStatusBadge status={i.status} />
                  </div>
                  <dl className="mt-2 grid grid-cols-1 gap-1 text-sm">
                    {config.columns
                      .filter((c) => c.header !== 'Status')
                      .map((c) => (
                        <div key={c.header} className="grid grid-cols-[7rem_1fr] gap-2">
                          <dt className="text-muted-foreground">{c.header}</dt>
                          <dd className="min-w-0 break-words">{c.cell(i)}</dd>
                        </div>
                      ))}
                  </dl>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>
            Page {page} of {totalPages} · {data.total} fitments
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

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Final approve {chosen.length} fitment(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              {chosen.map((i) => i.tkId).join(', ')} become OM approved. After this only an OM can change them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={approve.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={approve.isPending}
              onClick={(e) => {
                e.preventDefault();
                runApprove();
              }}
            >
              Final approve
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
