import { ROLE_LABELS, ROLE_SHORT_LABELS, type Role } from '@champ/shared';
import { Badge } from '@/components/ui/badge';

export function RoleBadge({ role, full = false }: { role: Role; full?: boolean }) {
  return (
    <Badge variant={role === 'SUPER_ADMIN' ? 'default' : 'secondary'} title={ROLE_LABELS[role]}>
      {full ? ROLE_LABELS[role] : ROLE_SHORT_LABELS[role]}
    </Badge>
  );
}
