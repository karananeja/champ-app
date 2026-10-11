import { Lock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

/** Marks a built-in master value (can't be renamed or deactivated). */
export function SystemBadge() {
  return (
    <Badge variant="outline" className="gap-1" title="Built in: can't be renamed or deactivated">
      <Lock className="size-3" /> Built-in
    </Badge>
  );
}
