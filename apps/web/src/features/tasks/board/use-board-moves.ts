import { useMutation, useQueryClient, type InfiniteData, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  statusAfterAssignment,
  type ApproveFitmentsResponse,
  type BoardCard,
  type BoardColumnDto,
  type BoardMoveKind,
  type BoardResponse,
} from '@champ/shared';
import { api, ApiError } from '@/lib/api';
import { tasksKeys } from '../queries';
import { boardKeys } from './queries';

/** A move the user confirmed: the cards, what to do, and the dialog's input. */
export interface BoardMoveRequest {
  kind: BoardMoveKind;
  cards: BoardCard[];
  /** ASSIGN (and "Change technician"): the chosen technician. */
  technician?: { id: string; name: string };
  /** REOPEN: one reason for all the cards. */
  reason?: string;
}

/** Thrown when some or all of the cards failed; lists the failed TK ids with the server's messages. */
class BoardMoveError extends Error {}

const label = (cards: BoardCard[]) => (cards.length === 1 ? cards[0]!.tkId : `${cards.length} fitments`);

/** The card as it should look after the move (status, technician, reopen count). */
function movedCard(card: BoardCard, move: BoardMoveRequest): BoardCard {
  switch (move.kind) {
    case 'ASSIGN':
      return { ...card, status: statusAfterAssignment(card.status, move.technician!.id), technician: move.technician! };
    case 'UNASSIGN':
      return { ...card, status: 'OPEN', technician: null };
    case 'APPROVE':
      return { ...card, status: 'OM_APPROVED' };
    case 'REOPEN':
      return { ...card, status: 'REOPENED', reopenCount: card.reopenCount + 1, billable: null };
  }
}

/** Soonest fitment first, then TK number (D-110), as the server orders a column. */
const byBoardOrder = (a: BoardCard, b: BoardCard) => a.fitmentAt.localeCompare(b.fitmentAt) || a.tkId.localeCompare(b.tkId);

/** The board with the cards moved to their new columns and the counts adjusted. */
export function applyMove(board: BoardResponse, moved: BoardCard[], before: BoardCard[]): BoardResponse {
  const ids = new Set(moved.map((c) => c.id));
  const columns = Object.fromEntries(
    Object.entries(board.columns).map(([status, column]) => {
      const leaving = before.filter((c) => c.status === status).length;
      const arriving = moved.filter((c) => c.status === status);
      const items = [...column.items.filter((c) => !ids.has(c.id)), ...arriving].sort(byBoardOrder);
      return [status, { ...column, items, count: Math.max(0, column.count - leaving + arriving.length) }];
    }),
  ) as BoardResponse['columns'];
  return { columns };
}

/** The failures of a batch of calls as one message: "TK-00001, TK-00002: <server message>". */
function failureMessage(results: PromiseSettledResult<unknown>[], groups: BoardCard[][]): string | null {
  const lines = results.flatMap((r, i) =>
    r.status === 'rejected'
      ? [`${groups[i]!.map((c) => c.tkId).join(', ')}: ${r.reason instanceof ApiError ? r.reason.message : 'Something went wrong'}`]
      : [],
  );
  return lines.length ? lines.join('\n') : null;
}

async function runMove(move: BoardMoveRequest): Promise<string> {
  const { cards } = move;
  switch (move.kind) {
    case 'ASSIGN':
    case 'UNASSIGN': {
      // One call per task (the assign endpoint takes the fitments of one task).
      const byTask = [...new Set(cards.map((c) => c.task.id))].map((taskId) => cards.filter((c) => c.task.id === taskId));
      const technicianId = move.kind === 'ASSIGN' ? move.technician!.id : null;
      const results = await Promise.allSettled(
        byTask.map((group) =>
          api(`/tasks/${group[0]!.task.id}/assign`, { method: 'POST', body: { fitmentIds: group.map((c) => c.id), technicianId } }),
        ),
      );
      const failed = failureMessage(results, byTask);
      if (failed) throw new BoardMoveError(failed);
      return move.kind === 'ASSIGN' ? `Assigned ${label(cards)} to ${move.technician!.name}` : `Unassigned ${label(cards)}`;
    }
    case 'APPROVE': {
      const { approved, failed } = await api<ApproveFitmentsResponse>('/fitments/approve', {
        method: 'POST',
        body: { fitmentIds: cards.map((c) => c.id) },
      });
      if (failed.length) {
        const prefix = approved.length ? `Final-approved ${approved.length}; could not approve ` : 'Could not approve ';
        throw new BoardMoveError(`${prefix}${failed.map((f) => `${f.tkId} (${f.message})`).join(', ')}`);
      }
      return `Final-approved ${label(cards)}`;
    }
    case 'REOPEN': {
      const results = await Promise.allSettled(
        cards.map((c) =>
          api(`/fitments/${c.id}/transitions`, { method: 'POST', body: { action: 'REOPEN', payload: { reason: move.reason } } }),
        ),
      );
      const failed = failureMessage(results, cards.map((c) => [c]));
      if (failed) throw new BoardMoveError(failed);
      return `Reopened ${label(cards)}`;
    }
  }
}

/**
 * Runs board moves through the existing endpoints (D-113) with optimistic updates: the cards move at once,
 * and on any failure the board is put back and the server's messages are shown verbatim (bulk approve lists
 * the failed TK ids). Every task query (board included) is refreshed afterwards, so partial successes show.
 */
export function useBoardMoves(query: Record<string, string>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: runMove,
    onMutate: async (move) => {
      await queryClient.cancelQueries({ queryKey: boardKeys.all });
      const snapshot = queryClient.getQueriesData({ queryKey: boardKeys.all });
      const moved = move.cards.map((c) => movedCard(c, move));
      const ids = new Set(move.cards.map((c) => c.id));
      queryClient.setQueryData<BoardResponse>(boardKeys.board(query), (old) => old && applyMove(old, moved, move.cards));
      // Cards loaded with "Load more" leave their old column too.
      queryClient.setQueriesData<InfiniteData<BoardColumnDto>>({ queryKey: boardKeys.morePrefix }, (old) =>
        old && { ...old, pages: old.pages.map((p) => ({ ...p, items: p.items.filter((c) => !ids.has(c.id)) })) },
      );
      return { snapshot };
    },
    onSuccess: (message) => toast.success(message),
    onError: (err, _move, context) => {
      for (const [key, data] of (context?.snapshot ?? []) as [QueryKey, unknown][]) queryClient.setQueryData(key, data);
      toast.error(err instanceof BoardMoveError || err instanceof ApiError ? err.message : 'Could not move the fitments');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: tasksKeys.all }),
  });
}
