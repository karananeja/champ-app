import {
  FITMENT_STATUS_LABELS,
  TASK_STATUS_LABELS,
  type FitmentStatus,
  type TaskStatus,
} from '@champ/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const styles: Partial<Record<FitmentStatus | TaskStatus, string>> = {
  OPEN: 'border-amber-200 bg-amber-50 text-amber-800',
  ASSIGNED: 'border-sky-200 bg-sky-50 text-sky-800',
  IN_PROGRESS: 'border-violet-200 bg-violet-50 text-violet-800',
  COMPLETED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  OM_APPROVED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  MOVED_TO_FT: 'border-red-200 bg-red-50 text-red-700',
  CLOSED_NOT_DONE: 'border-neutral-200 bg-neutral-100 text-neutral-600',
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return (
    <Badge variant="outline" className={cn(styles[status])} data-testid="task-status">
      {TASK_STATUS_LABELS[status]}
    </Badge>
  );
}

export function FitmentStatusBadge({ status }: { status: FitmentStatus }) {
  return (
    <Badge variant="outline" className={cn(styles[status] ?? 'border-violet-200 bg-violet-50 text-violet-800')}>
      {FITMENT_STATUS_LABELS[status]}
    </Badge>
  );
}
