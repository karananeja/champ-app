import { TRAVEL_EVENT_LABELS, TRAVEL_FIELD_LABELS, type TravelEventDto } from '@champ/shared';
import { formatIst } from '@/lib/format';
import { eventDetails } from '../tasks/history/event-details';

/** Keys shown in the event's header line or not at all. */
const HIDDEN = new Set(['ttId', 'attachmentId', 'contentType', 'reason', 'name']);
const fieldLabel = (key: string) => TRAVEL_FIELD_LABELS[key as keyof typeof TRAVEL_FIELD_LABELS] ?? key;

/** The history of a TT (F08), oldest first: who did what and when, the reason, the receipt and the changed fields. */
export function TravelHistory({ events }: { events: TravelEventDto[] }) {
  return (
    <ol className="grid gap-3 border-l pl-4" aria-label="History" data-testid="travel-history">
      {events.map((e) => {
        const data = (e.data ?? {}) as Record<string, unknown>;
        const diffs = eventDetails(data).filter((d) => !HIDDEN.has(d.key));
        return (
          <li key={e.id} className="relative grid gap-0.5 text-sm" data-testid="travel-event">
            <span className="absolute top-1.5 -left-[1.3rem] size-2 rounded-full bg-primary" aria-hidden />
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">{TRAVEL_EVENT_LABELS[e.type] ?? e.type}</span>
              <span className="text-muted-foreground">
                {e.actor.name} · {formatIst(e.at)}
              </span>
            </div>
            {typeof data.name === 'string' && <div className="break-words text-muted-foreground">{data.name}</div>}
            {typeof data.reason === 'string' && <div className="break-words">Reason: {data.reason}</div>}
            {diffs.length > 0 && (
              <ul className="grid gap-0.5 text-muted-foreground">
                {diffs.map((d) => (
                  <li key={d.key} className="break-words">
                    {fieldLabel(d.key)}: {d.value ?? `${d.before} → ${d.after}`}
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
