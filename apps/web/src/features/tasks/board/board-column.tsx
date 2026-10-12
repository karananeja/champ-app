import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { FITMENT_STATUS_LABELS, type BoardCard, type FitmentStatus } from '@champ/shared';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { STATUS_TONES } from '@/lib/tones';
import { cn } from '@/lib/utils';
import { useColumnDrop } from './column-state';

interface ColumnProps {
  status: FitmentStatus;
  count: number | undefined;
  items: BoardCard[];
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  /** A dragged card can't be dropped here: grey out. */
  disabled: boolean;
  /** The keyboard drag is over this column. */
  highlighted?: boolean;
  renderCard: (card: BoardCard, items: BoardCard[]) => ReactNode;
  className?: string;
}

/** The coloured header of a column: status, count. */
export function ColumnHeader({ status, count }: { status: FitmentStatus; count: number | undefined }) {
  return (
    <div className={cn('flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm font-medium', STATUS_TONES[status])}>
      <h2>{FITMENT_STATUS_LABELS[status]}</h2>
      <span className="tabular-nums" data-testid="column-count" aria-label={`${count ?? 0} fitments`}>
        {count ?? '–'}
      </span>
    </div>
  );
}

/**
 * One board column (F07): header with the status colour and count, the cards (skeletons while loading,
 * "Nothing here" when empty) and "Load more" at the bottom when the server has more.
 */
export function BoardColumn({ status, count, items, loading, hasMore, loadingMore, onLoadMore, disabled, highlighted, renderCard, className }: ColumnProps) {
  const { setNodeRef, isOver, dropProps } = useColumnDrop(status, disabled);
  return (
    <section
      ref={setNodeRef}
      {...dropProps}
      aria-label={`${FITMENT_STATUS_LABELS[status]} (${count ?? 0})`}
      className={cn(
        'flex min-h-40 flex-col gap-2 rounded-lg bg-muted/40 p-2 transition',
        (isOver || (highlighted && !disabled)) && 'bg-primary/10 ring-2 ring-primary',
        disabled && 'opacity-40 grayscale',
        className,
      )}
    >
      <ColumnHeader status={status} count={count} />
      {loading ? (
        <div role="status" aria-busy="true" aria-label="Loading" className="grid gap-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState size="sm" illustration="empty" title="Nothing here" className="py-4 [&_svg]:max-w-20" data-testid="column-empty" />
      ) : (
        <ul className="grid gap-2">{items.map((card) => renderCard(card, items))}</ul>
      )}
      {hasMore && (
        <Button variant="outline" size="sm" onClick={onLoadMore} disabled={loadingMore}>
          {loadingMore && <Loader2 className="animate-spin" />} Load more
        </Button>
      )}
    </section>
  );
}

/** A collapsed side lane: a compact drop target with its count. */
export function CollapsedLane({ status, count, disabled, highlighted }: { status: FitmentStatus; count: number | undefined; disabled: boolean; highlighted?: boolean }) {
  const { setNodeRef, isOver, dropProps } = useColumnDrop(status, disabled);
  return (
    <div
      ref={setNodeRef}
      {...dropProps}
      className={cn('min-w-48 flex-1 rounded-lg p-1 transition', (isOver || (highlighted && !disabled)) && 'ring-2 ring-primary', disabled && 'opacity-40 grayscale')}
    >
      <ColumnHeader status={status} count={count} />
    </div>
  );
}
