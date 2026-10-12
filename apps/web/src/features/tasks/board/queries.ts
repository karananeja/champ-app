import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { BoardColumnDto, BoardResponse, FitmentStatus } from '@champ/shared';
import { api } from '@/lib/api';

/** The board refreshes every 30 s and when the tab regains focus (intent §2); instant updates come in F13. */
export const BOARD_REFRESH_MS = 30_000;

/** Under `tasks`, so every task mutation (task page, simulator, verification) also refreshes the board. */
export const boardKeys = {
  all: ['tasks', 'board'] as const,
  board: (query: Record<string, string>) => ['tasks', 'board', 'first', query] as const,
  more: (status: FitmentStatus, query: Record<string, string>) => ['tasks', 'board', 'more', status, query] as const,
  morePrefix: ['tasks', 'board', 'more'] as const,
};

/** `GET /board`: the first page of every column. `paused` (a drag or dialog in progress) stops the refetching. */
export function useBoard(query: Record<string, string>, paused: boolean) {
  return useQuery({
    queryKey: boardKeys.board(query),
    queryFn: () => api<BoardResponse>('/board', { query }),
    placeholderData: keepPreviousData,
    // Always stale (the app default is 30 s), so returning to the tab refetches straight away.
    staleTime: 0,
    refetchInterval: paused ? false : BOARD_REFRESH_MS,
    refetchOnWindowFocus: !paused,
  });
}

/** "Load more" of one column: pages 2, 3, … of `GET /board/:status`, fetched once the button is first used. */
export function useBoardMore(status: FitmentStatus, query: Record<string, string>, enabled: boolean, paused: boolean) {
  return useInfiniteQuery({
    queryKey: boardKeys.more(status, query),
    queryFn: ({ pageParam }) => api<BoardColumnDto>(`/board/${status}`, { query: { ...query, page: pageParam } }),
    initialPageParam: 2,
    getNextPageParam: (last, pages) => (last.hasMore ? pages.length + 2 : undefined),
    enabled,
    // Always stale (the app default is 30 s), so returning to the tab refetches straight away.
    staleTime: 0,
    refetchInterval: paused ? false : BOARD_REFRESH_MS,
    refetchOnWindowFocus: !paused,
  });
}
