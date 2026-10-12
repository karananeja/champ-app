import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from './empty-state';
import type { IllustrationName } from './illustration';

/**
 * Loading skeleton for a list (CR-03): table-like rows from md up, cards on phones. Marked busy for assistive
 * technology.
 */
export function ListSkeleton({ rows = 5, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" data-testid="list-skeleton">
      <div className="hidden rounded-md border md:block">
        <div className="flex gap-4 border-b px-3 py-3">
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className="h-4 flex-1" />
          ))}
        </div>
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex items-center gap-4 border-b px-3 py-4 last:border-b-0">
            {Array.from({ length: columns }, (_, c) => (
              <Skeleton key={c} className={c === 0 ? 'h-4 flex-1' : 'h-4 flex-1 opacity-70'} />
            ))}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-2 md:hidden">
        {Array.from({ length: Math.min(rows, 3) }, (_, r) => (
          <div key={r} className="grid gap-2 rounded-md border p-3">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Loading skeleton for a detail page: header, a card of fields and a list. */
export function DetailSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className="grid grid-cols-1 gap-6" data-testid="detail-skeleton">
      <div className="grid gap-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="grid grid-cols-1 gap-4 rounded-xl border p-6 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="grid gap-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-4 w-32" />
          </div>
        ))}
      </div>
      <ListSkeleton rows={3} />
    </div>
  );
}

interface EmptyCopy {
  illustration?: IllustrationName;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}

interface ListStatesProps {
  isPending: boolean;
  isError: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** No rows to show. */
  isEmpty: boolean;
  /** A search or filter is active: show "no matches" (with a clear button) instead of the empty state. */
  filtered?: boolean;
  onClearFilters?: () => void;
  /** The empty state when nothing exists yet. */
  empty: EmptyCopy;
  /** Overrides the "no matches" copy. */
  noMatches?: Partial<EmptyCopy>;
  skeleton?: ReactNode;
  children: ReactNode;
}

/**
 * The states around a list (CR-03): skeleton while loading, ErrorState on failure, an illustrated empty state
 * when nothing exists, and an illustrated "no matches" when a search or filter hides everything. Renders the
 * list (`children`) otherwise.
 */
export function ListStates({
  isPending,
  isError,
  error,
  onRetry,
  isEmpty,
  filtered,
  onClearFilters,
  empty,
  noMatches,
  skeleton,
  children,
}: ListStatesProps) {
  if (isPending) return <>{skeleton ?? <ListSkeleton />}</>;
  if (isError) return <ErrorState error={error} onRetry={onRetry} size="sm" />;
  if (!isEmpty) return <>{children}</>;
  if (filtered) {
    return (
      <EmptyState
        size="sm"
        illustration={noMatches?.illustration ?? 'no-results'}
        title={noMatches?.title ?? 'No matches'}
        description={noMatches?.description ?? 'Nothing matches your search or filters. Try other words, or clear the filters.'}
        action={
          noMatches?.action ??
          (onClearFilters && (
            <Button variant="outline" onClick={onClearFilters}>
              <X /> Clear filters
            </Button>
          ))
        }
        data-testid="no-matches"
      />
    );
  }
  return (
    <EmptyState
      size="sm"
      illustration={empty.illustration ?? 'empty'}
      title={empty.title}
      description={empty.description}
      action={empty.action}
    />
  );
}
