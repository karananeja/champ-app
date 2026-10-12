import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { reopenReasonSchema, undoFaultyReasonSchema, type FitmentAction, type FitmentDto, type UserDto } from '@champ/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { useFitmentTransition } from './queries';

/** The review actions confirmed with this dialog (Verify opens the verification sheet instead, F06). */
export type ReviewAction = Extract<FitmentAction, 'APPROVE' | 'REOPEN' | 'UNDO_FAULTY'>;

const COPY: Record<ReviewAction, { title: string; confirm: string; done: string }> = {
  APPROVE: { title: 'Final approve', confirm: 'Final approve', done: 'final-approved' },
  REOPEN: { title: 'Reopen', confirm: 'Reopen', done: 'reopened' },
  UNDO_FAULTY: { title: 'Undo faulty', confirm: 'Undo faulty', done: 'is back to Assigned' },
};

/** The reason field of the actions that need one. */
const REASON: Partial<Record<ReviewAction, { label: string; placeholder: string; schema: typeof reopenReasonSchema }>> = {
  REOPEN: { label: 'Reason for reopening', placeholder: 'What needs to be redone?', schema: reopenReasonSchema },
  UNDO_FAULTY: { label: 'Reason for undoing', placeholder: 'Why was the fault marked by mistake?', schema: undoFaultyReasonSchema },
};

/** What the dialog needs of a fitment (a task-page fitment, an F07 board card or a Faulty-view row). */
export type ActionFitment = Pick<FitmentDto, 'id' | 'tkId' | 'status'> & {
  technician: { name: string } | null;
  replacement?: { tkId: string } | null;
};

function description(action: ReviewAction, fitments: ActionFitment[], actor: UserDto) {
  const many = fitments.length > 1;
  const technician = many ? 'their technicians' : (fitments[0]!.technician?.name ?? 'the technician');
  switch (action) {
    case 'APPROVE':
      return `Marks ${many ? 'the fitments' : 'the fitment'} OM approved. After this only an OM can change ${many ? 'them' : 'it'}, and every change is flagged in the history.`;
    case 'REOPEN': {
      // D-074: an OM reopening an OE-verified fitment counts against the OE too.
      const againstOe = actor.role !== 'OE' && fitments.some((f) => f.status === 'OE_VERIFIED');
      return `Sends ${many ? `${fitments.map((f) => f.tkId).join(', ')}` : 'the fitment'} back to ${technician} as Reopened. The reopen counts against the technician${againstOe ? ' and the operation executive' : ''}.`;
    }
    case 'UNDO_FAULTY': {
      // CR-11 (D-257): one fitment at a time; the server closes the replacement in the same transaction.
      const f = fitments[0]!;
      const replacement = f.replacement ? `its replacement ${f.replacement.tkId}` : 'its replacement';
      return `${f.tkId} goes back to Assigned with ${technician}; ${replacement} will be closed as "Faulty marked by mistake". The form and photos are kept, and the technician starts it again.`;
    }
  }
}

/**
 * Confirms a review action (Final approve, Reopen, Undo faulty). Reopen and Undo faulty need a reason (3–500
 * characters, the shared schemas).
 * By default it runs the transition on `fitment` and shows server refusals (e.g. 409 INVALID_TRANSITION)
 * verbatim. With `onConfirm` (F07 board: optimistic moves, several `fitments` sharing one reason) it only
 * collects the input, hands it over and closes.
 */
export function FitmentActionDialog({
  fitment,
  fitments: many,
  action,
  actor,
  onConfirm,
  onClose,
}: {
  fitment?: ActionFitment;
  fitments?: ActionFitment[];
  action: ReviewAction;
  actor: UserDto;
  onConfirm?: (input: { reason?: string }) => void;
  onClose: () => void;
}) {
  const fitments = many ?? (fitment ? [fitment] : []);
  const first = fitments[0]!;
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const transition = useFitmentTransition();
  const copy = COPY[action];
  const reasonField = REASON[action];

  const submit = () => {
    setError(null);
    let body: Parameters<typeof transition.mutate>[0]['body'] = { action: 'APPROVE' };
    let confirmed: { reason?: string } = {};
    if (reasonField) {
      const parsed = reasonField.schema.safeParse(reason);
      if (!parsed.success) {
        setError(parsed.error.issues[0]!.message);
        return;
      }
      confirmed = { reason: parsed.data };
      body = action === 'UNDO_FAULTY' ? { action, payload: { reason: parsed.data } } : { action: 'REOPEN', payload: { reason: parsed.data } };
    }
    if (onConfirm) {
      onConfirm(confirmed);
      onClose();
      return;
    }
    transition.mutate(
      { fitmentId: first.id, body },
      {
        onSuccess: () => {
          toast.success(`${first.tkId} ${copy.done}`);
          onClose();
        },
        onError: (err) => {
          const message = err instanceof ApiError ? err.message : `Could not ${copy.title.toLowerCase()} ${first.tkId}`;
          setError(message);
          toast.error(message);
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {copy.title} {fitments.length > 1 ? `${fitments.length} fitments` : first.tkId}?
          </DialogTitle>
          <DialogDescription>{description(action, fitments, actor)}</DialogDescription>
        </DialogHeader>
        <form
          className="grid grid-cols-1 gap-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {reasonField && (
            <div className="grid grid-cols-1 gap-2">
              <Label htmlFor="action-reason">{reasonField.label}</Label>
              <Textarea
                id="action-reason"
                value={reason}
                maxLength={500}
                rows={3}
                aria-invalid={!!error}
                placeholder={reasonField.placeholder}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          )}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={transition.isPending}>
              {transition.isPending && <Loader2 className="animate-spin" />} {copy.confirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
