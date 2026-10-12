import { FITMENT_STATUS_LABELS, TASK_STATUS_LABELS, type FitmentStatus, type TaskStatus } from '@champ/shared';
import { Badge } from '@/components/ui/badge';
import { STATUS_TONES } from '@/lib/tones';
import { cn } from '@/lib/utils';


export function FitmentStatusBadge({ status, className }: { status: FitmentStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn(STATUS_TONES[status], className)} data-testid="fitment-status">
      {FITMENT_STATUS_LABELS[status]}
    </Badge>
  );
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return (
    <Badge variant="outline" className={cn(STATUS_TONES[status])} data-testid="task-status">
      {TASK_STATUS_LABELS[status]}
    </Badge>
  );
}
