import { useState } from 'react';
import { ArrowDown, ArrowUp, Loader2, Settings2 } from 'lucide-react';
import type { SearchIdentifierSettingDto } from '@champ/shared';
import { ErrorState } from '@/components/empty-state';
import { ListSkeleton } from '@/components/list-states';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { ApiError } from '@/lib/api';
import { useSearchIdentifiers, useUpdateSearchIdentifiers } from './queries';

/** The editable list: a switch per identifier and up/down buttons (the order is the ranking, D-243). */
function IdentifierList({ initial }: { initial: SearchIdentifierSettingDto[] }) {
  const [items, setItems] = useState(initial);
  const update = useUpdateSearchIdentifiers();
  const noneOn = !items.some((i) => i.enabled);
  const dirty = items.some((item, index) => item.identifier !== initial[index]?.identifier || item.enabled !== initial[index]?.enabled);

  const move = (index: number, by: -1 | 1) =>
    setItems((prev) => {
      const next = [...prev];
      [next[index], next[index + by]] = [next[index + by]!, next[index]!];
      return next;
    });
  const toggle = (index: number, enabled: boolean) => setItems((prev) => prev.map((item, i) => (i === index ? { ...item, enabled } : item)));

  return (
    <form
      className="grid max-w-2xl grid-cols-1 gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (noneOn) return;
        update.mutate(items.map(({ identifier, enabled }) => ({ identifier, enabled })));
      }}
    >
      <Card className="gap-0 p-0">
        <ol className="divide-y" aria-label="Search identifiers">
          {items.map((item, index) => {
            const switchId = `search-identifier-${item.identifier}`;
            return (
              <li key={item.identifier} className="flex items-center gap-3 px-4 py-3" data-testid="search-identifier">
                <span className="w-5 text-right text-sm text-muted-foreground tabular-nums">{index + 1}</span>
                <label htmlFor={switchId} className="min-w-0 flex-1 text-sm font-medium">
                  {item.label}
                </label>
                <Switch id={switchId} checked={item.enabled} onCheckedChange={(on) => toggle(index, on)} />
                <Button type="button" variant="ghost" size="icon" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move ${item.label} up`}>
                  <ArrowUp />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={index === items.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label={`Move ${item.label} down`}
                >
                  <ArrowDown />
                </Button>
              </li>
            );
          })}
        </ol>
      </Card>
      {noneOn && (
        <p role="alert" className="text-sm text-destructive">
          Keep at least one identifier on
        </p>
      )}
      {update.isError && (
        <p role="alert" className="text-sm text-destructive">
          {update.error instanceof ApiError ? update.error.message : 'Could not save.'}
        </p>
      )}
      <div>
        <Button type="submit" disabled={noneOn || !dirty || update.isPending}>
          {update.isPending && <Loader2 className="animate-spin" />} Save
        </Button>
      </div>
    </form>
  );
}

/** Settings → Search identifiers (F14, SA only): which identifiers the global search looks in, and their ranking. */
export function SearchSettingsPage() {
  const list = useSearchIdentifiers();
  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Search identifiers"
        icon={Settings2}
        description="Which identifiers the global search looks in. Results rank in this order."
      />
      {list.isPending ? (
        <ListSkeleton rows={10} columns={2} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} size="sm" />
      ) : (
        // Keyed by the saved order so a save (or refetch) resets the draft.
        <IdentifierList key={list.data.map((i) => `${i.identifier}:${i.enabled}`).join(',')} initial={list.data} />
      )}
    </div>
  );
}
