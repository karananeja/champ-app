import { FITMENT_STATUS_LABELS, TASK_STATUS_LABELS, type FitmentStatus, type TaskStatus } from '@champ/shared';
import { Badge } from '@/components/ui/badge';
import { TONES } from '@/lib/tones';
import { cn } from '@/lib/utils';

/** One colour per workflow status, used for task and fitment badges across the app (F05). */
const STATUS_STYLES: Record<FitmentStatus | TaskStatus, string> = {
  OPEN: TONES.amber,
  ASSIGNED: TONES.sky,
  IN_PROGRESS: TONES.violet,
  SUBMITTED: TONES.blue,
  OE_VERIFIED: TONES.teal,
  OM_APPROVED: TONES.emerald,
  COMPLETED: TONES.emerald,
  CLOSED_NOT_DONE: TONES.neutral,
  MOVED_TO_FT: TONES.red,
  REOPENED: TONES.orange,
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
