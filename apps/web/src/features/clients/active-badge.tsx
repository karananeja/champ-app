import { Badge } from '@/components/ui/badge';

/** Active / Inactive badge for clients and sites (same colours as masters). */
export function ActiveBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
      Active
    </Badge>
  ) : (
    <Badge variant="outline" className="border-neutral-200 bg-neutral-100 text-neutral-600">
      Inactive
    </Badge>
  );
}
