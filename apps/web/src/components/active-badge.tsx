import { Badge } from '@/components/ui/badge';
import { TONES } from '@/lib/tones';

/** Active / Inactive badge for clients, sites and master values (one look everywhere, CR-03). */
export function ActiveBadge({ active }: { active: boolean }) {
  return (
    <Badge variant="outline" className={active ? TONES.emerald : TONES.neutral}>
      {active ? 'Active' : 'Inactive'}
    </Badge>
  );
}
