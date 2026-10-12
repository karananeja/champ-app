import { Badge } from '@/components/ui/badge';
import { TONES } from '@/lib/tones';
import { cn } from '@/lib/utils';

/** "Billable: Yes" (emerald) or "Billable: No" (neutral); nothing while undecided (F06, D-101). */
export function BillableBadge({ billable, className }: { billable: boolean | null | undefined; className?: string }) {
  if (billable === null || billable === undefined) return null;
  return (
    <Badge variant="outline" className={cn(billable ? TONES.emerald : TONES.neutral, className)} data-testid="billable-badge">
      Billable: {billable ? 'Yes' : 'No'}
    </Badge>
  );
}
