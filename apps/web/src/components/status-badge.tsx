import type { InviteStatus, UserStatus } from '@champ/shared';
import { Badge } from '@/components/ui/badge';
import { TONES } from '@/lib/tones';
import { cn } from '@/lib/utils';

const styles: Record<UserStatus | InviteStatus, string> = {
  ACTIVE: TONES.emerald,
  INACTIVE: TONES.neutral,
  PENDING: TONES.amber,
  USED: TONES.emerald,
  EXPIRED: TONES.neutral,
  REVOKED: TONES.red,
};

export function StatusBadge({ status }: { status: UserStatus | InviteStatus }) {
  return (
    <Badge variant="outline" className={cn('capitalize', styles[status])}>
      {status.toLowerCase()}
    </Badge>
  );
}
