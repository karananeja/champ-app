import { Suspense, lazy, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { TECHNICIAN_TYPE_LABELS, canManageTask, type TaskDto, type TaskRef } from '@champ/shared';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiError } from '@/lib/api';
import { useCurrentUser } from '@/lib/auth';
import { useAppConfig } from '@/lib/config';
import { formatIst } from '@/lib/format';
import { cn } from '@/lib/utils';
import { FitmentsSection } from './fitments-section';
import { TaskHistory } from './history/task-history';
import { useDeleteTask, useTask } from './queries';
import { TaskStatusBadge } from '@/components/fitment-status-badge';

/**
 * The dev-only technician simulator (D-073). `import.meta.env.DEV` is false in production builds, so the
 * lazy import is dropped and the panel's code never reaches the bundle (checked by `prod-bundle.test.ts`).
 */
const SimulatorPanel = import.meta.env.DEV ? lazy(() => import('./simulator/simulator-panel')) : null;

/** Shows the simulator to SA, OM and the task's OE when the API has it enabled. */
function DevSimulator({ task }: { task: TaskDto }) {
  const actor = useCurrentUser();
  const config = useAppConfig();
  if (!SimulatorPanel || !config.data?.devSimulator || !canManageTask(actor, task)) return null;
  return (
    <Suspense fallback={null}>
      <SimulatorPanel task={task} />
    </Suspense>
  );
}

/**
 * `/tasks/:id`: every task field, the fitments with their workflow actions, Edit/Delete per the server's
 * flags, and (SA/OM) a History tab with the stage timeline and raw events (F05).
 */
export function TaskDetailPage() {
  const { id = '' } = useParams();
  const { data: task, isPending, isError, error } = useTask(id);
  if (isPending) {
    return (
      <div className="grid grid-cols-1 gap-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }
  if (isError) {
    const gone = error instanceof ApiError && error.status === 404;
    return (
      <div className="grid grid-cols-1 gap-3 py-8 text-center text-sm">
        <p className={gone ? 'text-muted-foreground' : 'text-destructive'}>
          {gone ? 'This task does not exist or was deleted.' : 'Could not load the task.'}
        </p>
        <Link to="/tasks" className="underline">
          Back to open tasks
        </Link>
      </div>
    );
  }
  return <TaskDetail task={task} />;
}

const refName = (ref: Pick<TaskRef, 'name' | 'active'>) => (ref.active ? ref.name : `${ref.name} (inactive)`);

function TaskDetail({ task }: { task: TaskDto }) {
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const remove = useDeleteTask();
  const { canEdit, canDelete } = task.permissions;

  const onDelete = () =>
    remove.mutate(task.id, {
      onSuccess: () => {
        toast.success(`${task.omId} deleted`);
        navigate('/tasks');
      },
      onError: (err) => {
        toast.error(err instanceof ApiError ? err.message : 'Could not delete the task');
        setConfirmDelete(false);
      },
    });

  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Button asChild variant="ghost" size="icon-sm" aria-label="Back to tasks">
            <Link to="/tasks">
              <ArrowLeft />
            </Link>
          </Button>
          <h1 className="font-mono text-2xl font-semibold tracking-tight">{task.omId}</h1>
          <Badge variant="secondary" className="font-mono" data-testid="oe-task-id">
            {task.oeTaskId}
          </Badge>
          <TaskStatusBadge status={task.status} />
        </div>
        {(canEdit || canDelete) && (
          <div className="flex flex-wrap gap-2">
            {canDelete && (
              <Button variant="outline" onClick={() => setConfirmDelete(true)}>
                <Trash2 /> Delete
              </Button>
            )}
            {canEdit && (
              <Button asChild>
                <Link to={`/tasks/${task.id}/edit`}>
                  <Pencil /> Edit task
                </Link>
              </Button>
            )}
          </div>
        )}
      </div>

      {task.permissions.canViewHistory ? (
        <Tabs defaultValue="details" className="gap-4">
          <TabsList>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
          <TabsContent value="details">
            <TaskDetails task={task} />
          </TabsContent>
          <TabsContent value="history">
            <TaskHistory taskId={task.id} omId={task.omId} />
          </TabsContent>
        </Tabs>
      ) : (
        <TaskDetails task={task} />
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {task.omId}?</AlertDialogTitle>
            <AlertDialogDescription>
              The task and its {task.counts.total} fitment(s) disappear from every list. The deletion is kept in the
              audit log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                onDelete();
              }}
            >
              Delete task
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** The Details tab: the task's fields, its fitments and (dev only) the technician simulator. */
function TaskDetails({ task }: { task: TaskDto }) {
  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <InfoCard title="Customer">
          <Info label="Customer">{refName(task.client)}</Info>
          <Info label="Site">
            {refName(task.site)}
            <div className="text-muted-foreground">{task.site.address}</div>
          </Info>
          <Info label="Fitment location">
            {task.location.city}, {task.location.state}
          </Info>
          <Info label="Customer POC">
            {task.pocName}
            <div className="text-muted-foreground">{task.pocPhone}</div>
            {task.pocEmail && <div className="break-all text-muted-foreground">{task.pocEmail}</div>}
          </Info>
        </InfoCard>
        <InfoCard title="Assignment">
          <Info label="Operation executive">{refName(task.oe)}</Info>
          <Info label="Technician type">{task.technicianType ? TECHNICIAN_TYPE_LABELS[task.technicianType] : 'Any'}</Info>
          <Info label="Task type">{task.taskType.name}</Info>
          <Info label="Created by">
            {task.createdBy.name}
            <div className="text-muted-foreground">{formatIst(task.createdAt)}</div>
          </Info>
        </InfoCard>
        <InfoCard title="Asset and device">
          <Info label="Asset type">{refName(task.assetType)}</Info>
          <Info label="Activity">{refName(task.activity)}</Info>
          <Info label="Device type">{refName(task.deviceType)}</Info>
          {task.makeModel && (
            <Info label="Vehicle make/model">{refName({ name: `${task.makeModel.make} ${task.makeModel.model}`, active: task.makeModel.active })}</Info>
          )}
          <Info label="Installation type">{refName(task.installationType)}</Info>
        </InfoCard>
        <InfoCard title="Schedule (IST)">
          <Info label="Requested fitment">{formatIst(task.requestedAt)}</Info>
          <Info label="Fitment">{formatIst(task.fitmentAt)}</Info>
          <Info label="Shift">{refName(task.shiftType)}</Info>
        </InfoCard>
        <InfoCard title="Other" className="lg:col-span-2">
          <Info label="Issue reported by client">{refName(task.issueReported)}</Info>
          <Info label="GPS address">{task.gpsAddress ?? '—'}</Info>
          <Info label="Comments" className="sm:col-span-2">
            <span className="whitespace-pre-wrap">{task.comments ?? '—'}</span>
          </Info>
        </InfoCard>
      </div>

      <FitmentsSection task={task} />
      <DevSimulator task={task} />
    </div>
  );
}

function InfoCard({ title, className, children }: { title: string; className?: string; children: ReactNode }) {
  return (
    <Card className={cn('gap-3 py-4', className)}>
      <CardHeader className="px-4">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-x-6 gap-y-3 px-4 text-sm sm:grid-cols-2">{children}</CardContent>
    </Card>
  );
}

function Info({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn('min-w-0 break-words', className)}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div>{children}</div>
    </div>
  );
}
