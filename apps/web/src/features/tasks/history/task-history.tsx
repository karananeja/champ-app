import { useState } from 'react';
import { toast } from 'sonner';
import { Check, ChevronDown, Circle, Download, Loader2, RotateCcw } from 'lucide-react';
import {
  FITMENT_STATUS_LABELS,
  ROLE_SHORT_LABELS,
  TASK_EVENT_LABELS,
  type StageStep,
  type StageTimeline,
  type TaskEventDto,
  type TaskHistoryResponse,
} from '@champ/shared';
import { FitmentStatusBadge } from '@/components/fitment-status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ApiError } from '@/lib/api';
import { formatIst } from '@/lib/format';
import { cn } from '@/lib/utils';
import { downloadTaskEvents, useTaskEvents, useTaskHistory } from '../queries';
import { eventDetails } from './event-details';
import { EmptyState, ErrorState } from '@/components/empty-state';
import { ListSkeleton } from '@/components/list-states';

const STAGES: { key: keyof StageTimeline; title: string; hint: string }[] = [
  { key: 'first', title: 'First stage', hint: 'Open / Assigned' },
  { key: 'second', title: 'Second stage', hint: 'In progress / Submitted' },
  { key: 'verification', title: 'Verification', hint: 'OE verified' },
  { key: 'final', title: 'Final stage', hint: 'OM approved' },
];

const who = (s: StageStep['by']) => (s ? s.name : 'someone');

/** A four-stage stepper: horizontal on md+, vertical on phones. Times in IST. */
export function StageStepper({ stages, label }: { stages: StageTimeline; label: string }) {
  return (
    <ol className="grid grid-cols-1 gap-3 md:grid-cols-4" aria-label={label}>
      {STAGES.map(({ key, title, hint }) => {
        const step = stages[key];
        const state = !step ? 'pending' : step.completedAt ? 'done' : 'current';
        return (
          <li key={key} data-testid={`stage-${key}`} data-state={state} className="flex gap-3 md:flex-col md:gap-2">
            <div className="flex items-center gap-2 md:w-full">
              <span
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs',
                  state === 'done' && 'border-emerald-500 bg-emerald-500 text-white',
                  state === 'current' && 'border-violet-500 text-violet-600',
                  state === 'pending' && 'text-muted-foreground',
                )}
              >
                {state === 'done' ? <Check className="size-4" /> : <Circle className="size-3" />}
              </span>
              <span className="hidden h-px flex-1 bg-border md:block" aria-hidden />
            </div>
            <div className="min-w-0 text-sm">
              <div className="font-medium">{title}</div>
              <div className="text-xs text-muted-foreground">{hint}</div>
              {step ? (
                <div className="mt-1 grid gap-0.5 text-xs">
                  <span>
                    {formatIst(step.at)} · {who(step.by)}
                  </span>
                  {step.completedAt && step.completedAt !== step.at && (
                    <span className="text-muted-foreground">
                      Done {formatIst(step.completedAt)} · {who(step.completedBy)}
                    </span>
                  )}
                </div>
              ) : (
                <div className="mt-1 text-xs text-muted-foreground">Not reached</div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function FitmentHistory({ fitment }: { fitment: TaskHistoryResponse['fitments'][number] }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-md border" data-testid="fitment-history">
      <button
        type="button"
        className="flex w-full flex-wrap items-center justify-between gap-2 p-3 text-left"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-mono font-medium">{fitment.tkId}</span>
          <FitmentStatusBadge status={fitment.status} />
          <span className="text-sm text-muted-foreground">{fitment.technician?.name ?? 'No technician'}</span>
          {fitment.reopenLoops.length > 0 && (
            <span className="flex items-center gap-1 text-xs text-orange-700">
              <RotateCcw className="size-3" /> {fitment.reopenLoops.length} reopen(s)
            </span>
          )}
        </span>
        <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="grid grid-cols-1 gap-4 border-t p-3">
          <StageStepper stages={fitment.stages} label={`${fitment.tkId} stages`} />
          {fitment.reopenLoops.length > 0 && (
            <div className="grid gap-2">
              <div className="text-sm font-medium">Reopen loops</div>
              <ul className="grid gap-2">
                {fitment.reopenLoops.map((loop) => (
                  <li key={loop.at} className="rounded-md bg-orange-50 p-2 text-sm" data-testid="reopen-loop">
                    <div>
                      {formatIst(loop.at)} · {loop.by.name} reopened it (was {FITMENT_STATUS_LABELS[loop.fromStatus]})
                    </div>
                    <div className="break-words">Reason: {loop.reason}</div>
                    {loop.attributions.length > 0 && (
                      <div className="text-xs text-muted-foreground">
                        Counts against: {loop.attributions.map((a) => `${a.user.name} (${ROLE_SHORT_LABELS[a.role]})`).join(', ')}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function EventDetails({ event }: { event: TaskEventDto }) {
  const details = eventDetails(event.data);
  if (!details.length) return <span className="text-muted-foreground">No data</span>;
  return (
    <dl className="grid grid-cols-1 gap-1 text-xs" data-testid="event-details">
      {details.map((d) => (
        <div key={d.key} className="break-all">
          <dt className="inline font-medium">{d.key}: </dt>
          <dd className="inline">
            {d.value ?? (
              <>
                <span className="text-red-700 line-through">{d.before}</span> → <span className="text-emerald-700">{d.after}</span>
              </>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const ALL = 'ALL';
const TASK_ONLY = 'TASK';

function RawData({ taskId, omId }: { taskId: string; omId: string }) {
  const { data, isPending, isError, error, refetch } = useTaskEvents(taskId);
  const [filter, setFilter] = useState(ALL);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const events = data?.items ?? [];
  const fitments = [...new Set(events.flatMap((e) => (e.fitment ? [e.fitment.tkId] : [])))].sort();
  const shown = events.filter((e) => filter === ALL || (filter === TASK_ONLY ? !e.fitment : e.fitment?.tkId === filter));
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const download = async () => {
    setDownloading(true);
    try {
      await downloadTaskEvents(taskId, omId);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not download the events');
    } finally {
      setDownloading(false);
    }
  };

  const fromTo = (e: TaskEventDto) => (e.fromStatus || e.toStatus ? `${e.fromStatus ?? '—'} → ${e.toStatus ?? '—'}` : '');
  const toggleButton = (e: TaskEventDto) => (
    <Button variant="ghost" size="xs" aria-expanded={expanded.has(e.id)} onClick={() => toggle(e.id)}>
      {expanded.has(e.id) ? 'Hide' : 'Details'}
    </Button>
  );

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>Raw data</CardTitle>
        <CardDescription>Every change to this task, oldest first (times in IST).</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3">
        <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center sm:justify-between">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger aria-label="Filter events" className="w-full sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All events</SelectItem>
              <SelectItem value={TASK_ONLY}>Task only</SelectItem>
              {fitments.map((tk) => (
                <SelectItem key={tk} value={tk}>
                  {tk}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => void download()} disabled={downloading}>
            {downloading ? <Loader2 className="animate-spin" /> : <Download />} Download CSV
          </Button>
        </div>
        {isPending ? (
          <ListSkeleton rows={4} columns={6} />
        ) : isError ? (
          <ErrorState error={error} size="sm" title="Could not load the events" onRetry={() => void refetch()} />
        ) : shown.length === 0 ? (
          <EmptyState size="sm" illustration="no-results" title="No events" description="No event matches this filter." />
        ) : (
          <>
            <div className="hidden rounded-md border md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time (IST)</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Fitment</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>From → to</TableHead>
                    <TableHead>Data</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((e) => (
                    <TableRow key={e.id} data-testid="event-row" className="align-top">
                      <TableCell>{formatIst(e.at)}</TableCell>
                      <TableCell className="whitespace-normal">{e.actor.name}</TableCell>
                      <TableCell className="font-mono">{e.fitment?.tkId ?? '—'}</TableCell>
                      <TableCell className="whitespace-normal">{TASK_EVENT_LABELS[e.type] ?? e.type}</TableCell>
                      <TableCell className="text-xs">{fromTo(e)}</TableCell>
                      <TableCell className="max-w-80 whitespace-normal">
                        {toggleButton(e)}
                        {expanded.has(e.id) && <EventDetails event={e} />}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul className="grid grid-cols-1 gap-2 md:hidden">
              {shown.map((e) => (
                <li key={e.id} data-testid="event-card" className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{TASK_EVENT_LABELS[e.type] ?? e.type}</span>
                    <span className="font-mono text-xs">{e.fitment?.tkId}</span>
                  </div>
                  <div className="text-muted-foreground">
                    {formatIst(e.at)} · {e.actor.name}
                  </div>
                  {fromTo(e) && <div className="text-xs break-words">{fromTo(e)}</div>}
                  {toggleButton(e)}
                  {expanded.has(e.id) && <EventDetails event={e} />}
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** The History tab (SA/OM, D-033): the task and per-fitment stage timelines, then the raw event log. */
export function TaskHistory({ taskId, omId }: { taskId: string; omId: string }) {
  const { data, isPending, isError, error, refetch } = useTaskHistory(taskId);
  return (
    <div className="grid grid-cols-1 gap-4">
      <Card className="gap-4">
        <CardHeader>
          <CardTitle>Stage timeline</CardTitle>
          <CardDescription>Where the task is, who acted and when.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4">
          {isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : isError ? (
            <ErrorState error={error} size="sm" title="Could not load the history" onRetry={() => void refetch()} />
          ) : (
            <>
              <StageStepper stages={data.task} label="Task stages" />
              <div className="grid gap-2">
                <div className="text-sm font-medium">Fitments</div>
                <ul className="grid gap-2">
                  {data.fitments.map((f) => (
                    <FitmentHistory key={f.id} fitment={f} />
                  ))}
                </ul>
              </div>
            </>
          )}
        </CardContent>
      </Card>
      <RawData taskId={taskId} omId={omId} />
    </div>
  );
}
