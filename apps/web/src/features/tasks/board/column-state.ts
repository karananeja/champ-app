import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import type { BoardColumnDto, FitmentStatus } from '@champ/shared';
import { useBoardMore } from './queries';

/** The droppable id of a column. */
export const columnId = (status: FitmentStatus) => `column:${status}`;
export const statusOfColumn = (id: string | number): FitmentStatus | null =>
  typeof id === 'string' && id.startsWith('column:') ? (id.slice(7) as FitmentStatus) : null;

/** The column's cards: the board's first page plus the pages loaded with "Load more" (no duplicates). */
export function useColumnCards(status: FitmentStatus, column: BoardColumnDto | undefined, query: Record<string, string>, paused: boolean) {
  const [loadMore, setLoadMore] = useState(false);
  const more = useBoardMore(status, query, loadMore, paused);
  const seen = new Set<string>();
  const items = [...(column?.items ?? []), ...(more.data?.pages.flatMap((p) => p.items) ?? [])].filter((c) => {
    if (c.status !== status || seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
  const hasMore = loadMore ? !!more.hasNextPage : !!column?.hasMore;
  const fetchMore = () => {
    if (!loadMore) setLoadMore(true);
    else void more.fetchNextPage();
  };
  return { items, hasMore, fetchMore, loadingMore: more.isFetching && (more.isFetchingNextPage || more.isPending) };
}

/** The droppable area of a column, greyed out (aria-disabled) while a card that can't go there is dragged. */
export function useColumnDrop(status: FitmentStatus, disabled: boolean) {
  const { setNodeRef, isOver } = useDroppable({ id: columnId(status) });
  return {
    setNodeRef,
    isOver: isOver && !disabled,
    dropProps: {
      'data-testid': 'board-column',
      'data-status': status,
      'aria-disabled': disabled || undefined,
    },
  };
}

