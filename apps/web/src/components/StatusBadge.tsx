import type { InviteStatus, UserStatus } from '@champ/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const styles: Record<UserStatus | InviteStatus, string> = {
  ACTIVE: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  INACTIVE: 'border-neutral-200 bg-neutral-100 text-neutral-600',
  PENDING: 'border-amber-200 bg-amber-50 text-amber-700',
  USED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  EXPIRED: 'border-neutral-200 bg-neutral-100 text-neutral-600',
  REVOKED: 'border-red-200 bg-red-50 text-red-700',
};

export function StatusBadge({ status }: { status: UserStatus | InviteStatus }) {
  return (
    <Badge variant="outline" className={cn('capitalize', styles[status])}>
      {status.toLowerCase()}
    </Badge>
  );
}
