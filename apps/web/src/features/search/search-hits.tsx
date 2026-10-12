import {
  SEARCH_IDENTIFIER_LABELS,
  type SearchFitmentHit,
  type SearchMatch,
  type SearchTaskHit,
  type SearchTravelHit,
} from '@champ/shared';
import { FitmentStatusBadge, TaskStatusBadge, TravelStatusBadge } from '@/components/fitment-status-badge';
import { matchRange } from './search-format';

/** A value with its matched part in bold. */
export function Highlight({ value, q }: { value: string; q: string }) {
  const [start, end] = matchRange(value, q);
  return (
    <>
      {value.slice(0, start)}
      <mark className="bg-transparent font-semibold text-foreground" data-testid="search-highlight">
        {value.slice(start, end)}
      </mark>
      {value.slice(end)}
    </>
  );
}

/** "Device id: **LAF5-00123**" for each match. */
export function MatchList({ matches, q }: { matches: SearchMatch[]; q: string }) {
  if (!matches.length) return null;
  return (
    <span className="flex min-w-0 flex-wrap gap-x-3 text-xs text-muted-foreground">
      {matches.map((m) => (
        <span key={m.identifier} className="break-all">
          {SEARCH_IDENTIFIER_LABELS[m.identifier]}: <Highlight value={m.value} q={q} />
        </span>
      ))}
    </span>
  );
}

/** The content of a task hit: OM id · customer · site, the task-level matches, and the status. */
export function TaskHitContent({ hit, q }: { hit: SearchTaskHit; q: string }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium">{hit.omId}</span>
        <span className="min-w-0 truncate text-muted-foreground">
          {hit.customer} · {hit.site}
        </span>
        <TaskStatusBadge status={hit.status} />
      </span>
      <MatchList matches={hit.matches} q={q} />
    </span>
  );
}

/** A fitment under its task: TK id · reg no., its matches ("Device id: **LAF5-00123**"), and the status. */
export function FitmentHitContent({ fitment, q }: { fitment: SearchFitmentHit; q: string }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium">{fitment.tkId}</span>
        {fitment.vehicleRegNo && <span className="min-w-0 truncate text-muted-foreground">{fitment.vehicleRegNo}</span>}
        <FitmentStatusBadge status={fitment.status} />
      </span>
      <MatchList matches={fitment.matches} q={q} />
    </span>
  );
}

/** A travel task: TT id · technician, and the status. */
export function TravelHitContent({ hit, q }: { hit: SearchTravelHit; q: string }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium">
          <Highlight value={hit.ttId} q={q} />
        </span>
        <span className="min-w-0 truncate text-muted-foreground">{hit.technician}</span>
        <TravelStatusBadge status={hit.status} />
      </span>
    </span>
  );
}
