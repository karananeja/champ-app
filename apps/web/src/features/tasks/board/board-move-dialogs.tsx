import type { BoardCard, BoardMoveKind, UserDto } from '@champ/shared';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AssignDialog } from '../assign-dialog';
import { FitmentActionDialog } from '../fitment-action-dialog';
import type { BoardMoveRequest } from './use-board-moves';

/** A move waiting for its dialog: the cards and the kind; `reassign` when it comes from "Change technician". */
export interface PendingMove {
  kind: BoardMoveKind;
  cards: BoardCard[];
  reassign?: boolean;
  currentTechnicianId?: string | null;
}

const tkList = (cards: BoardCard[]) => cards.map((c) => c.tkId).join(', ');
const what = (cards: BoardCard[]) => (cards.length === 1 ? cards[0]!.tkId : `${cards.length} fitments`);

/**
 * The dialog of a board move (F07): Assign asks for the technician (the assign dialog), Unassign and Final
 * approve confirm, Reopen asks for the reason (the task page's reopen dialog, one reason for all the cards).
 * Confirming hands the move to `onConfirm` (optimistic update and API calls) and closes.
 */
export function BoardMoveDialog({
  pending,
  actor,
  onConfirm,
  onClose,
}: {
  pending: PendingMove;
  actor: UserDto;
  onConfirm: (move: BoardMoveRequest) => void;
  onClose: () => void;
}) {
  const { kind, cards } = pending;
  switch (kind) {
    case 'ASSIGN':
      return (
        <AssignDialog
          tkIds={cards.map((c) => c.tkId)}
          currentTechnicianId={pending.currentTechnicianId ?? null}
          title={pending.reassign ? `Change technician · ${what(cards)}` : undefined}
          onConfirm={(technician) => {
            onConfirm({ kind, cards, technician });
            onClose();
          }}
          onClose={onClose}
        />
      );
    case 'REOPEN':
      return (
        <FitmentActionDialog
          fitments={cards}
          action="REOPEN"
          actor={actor}
          onConfirm={({ reason }) => onConfirm({ kind, cards, reason })}
          onClose={onClose}
        />
      );
    case 'UNASSIGN':
    case 'APPROVE': {
      const approve = kind === 'APPROVE';
      return (
        <AlertDialog open onOpenChange={(open) => !open && onClose()}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {approve ? 'Final approve' : 'Unassign'} {what(cards)}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {approve
                  ? `${tkList(cards)} become${cards.length === 1 ? 's' : ''} OM approved. After this only an OM can change ${cards.length === 1 ? 'it' : 'them'}.`
                  : `${tkList(cards)} go${cards.length === 1 ? 'es' : ''} back to Open without a technician.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  onConfirm({ kind, cards });
                  onClose();
                }}
              >
                {approve ? 'Final approve' : 'Unassign'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      );
    }
  }
}
