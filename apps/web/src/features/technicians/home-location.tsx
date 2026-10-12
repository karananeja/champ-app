import { ExternalLink } from 'lucide-react';
import type { HomeLocationDto } from '@champ/shared';
import { formatDay, istToday } from '@/lib/dates';
import { osmMapUrl } from '@/lib/maps';

/**
 * A technician's home location (F09, D-129): set by the technician in the field app, read-only on web for every
 * role. Shows the address, an "Open map" link and the IST date it was last updated, or "Not set".
 */
export function HomeLocation({ value, className }: { value: HomeLocationDto | null; className?: string }) {
  if (!value) return <span className={`text-muted-foreground ${className ?? ''}`}>Not set</span>;
  return (
    <div className={`grid min-w-0 gap-0.5 ${className ?? ''}`} data-testid="home-location">
      <span className="whitespace-normal break-words">{value.address}</span>
      <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <a
          href={osmMapUrl(value.lat, value.lng)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
        >
          Open map <ExternalLink className="size-3" aria-hidden />
        </a>
        <span>Updated {formatDay(istToday(new Date(value.updatedAt)))}</span>
      </span>
    </div>
  );
}
