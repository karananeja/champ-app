import { FITMENT_STATUS_LABELS, TASK_STATUS_LABELS, type FitmentStatus, type TaskStatus } from '@champ/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** One colour per workflow status, used for task and fitment badges across the app (F05). */
const STATUS_STYLES: Record<FitmentStatus | TaskStatus, string> = {
  OPEN: 'border-amber-200 bg-amber-50 text-amber-800',
  ASSIGNED: 'border-sky-200 bg-sky-50 text-sky-800',
  IN_PROGRESS: 'border-violet-200 bg-violet-50 text-violet-800',
  SUBMITTED: 'border-indigo-200 bg-indigo-50 text-indigo-800',
  OE_VERIFIED: 'border-teal-200 bg-teal-50 text-teal-800',
  OM_APPROVED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  COMPLETED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  CLOSED_NOT_DONE: 'border-neutral-200 bg-neutral-100 text-neutral-600',
  MOVED_TO_FT: 'border-red-200 bg-red-50 text-red-700',
  REOPENED: 'border-orange-200 bg-orange-50 text-orange-800',
};

export function FitmentStatusBadge({ status, className }: { status: FitmentStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn(STATUS_STYLES[status], className)} data-testid="fitment-status">
      {FITMENT_STATUS_LABELS[status]}
    </Badge>
  );
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return (
    <Badge variant="outline" className={cn(STATUS_STYLES[status])} data-testid="task-status">
      {TASK_STATUS_LABELS[status]}
    </Badge>
  );
}
