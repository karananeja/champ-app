import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { reopenReasonSchema, type FitmentAction, type FitmentDto, type UserDto } from '@champ/shared';
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
export type ReviewAction = Extract<FitmentAction, 'APPROVE' | 'REOPEN'>;

const COPY: Record<ReviewAction, { title: string; confirm: string; done: string }> = {
  APPROVE: { title: 'Final approve', confirm: 'Final approve', done: 'final-approved' },
  REOPEN: { title: 'Reopen', confirm: 'Reopen', done: 'reopened' },
};

function description(action: ReviewAction, fitment: FitmentDto, actor: UserDto) {
  const technician = fitment.technician?.name ?? 'the technician';
  switch (action) {
    case 'APPROVE':
      return 'Marks the fitment OM approved. After this only an OM can change it, and every change is flagged in the history.';
    case 'REOPEN': {
      // D-074: an OM reopening an OE-verified fitment counts against the OE too.
      const againstOe = actor.role !== 'OE' && fitment.status === 'OE_VERIFIED';
      return `Sends the fitment back to ${technician} as Reopened. The reopen counts against the technician${againstOe ? ' and the operation executive' : ''}.`;
    }
  }
}

/**
 * Confirms a review action on one fitment (Final approve, Reopen). Reopen needs a reason (3–500 characters, the shared schema).
 * Server refusals (e.g. 409 INVALID_TRANSITION) are shown verbatim.
 */
export function FitmentActionDialog({
  fitment,
  action,
  actor,
  onClose,
}: {
  fitment: FitmentDto;
  action: ReviewAction;
  actor: UserDto;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const transition = useFitmentTransition();
  const copy = COPY[action];

  const submit = () => {
    setError(null);
    let body: Parameters<typeof transition.mutate>[0]['body'];
    if (action === 'REOPEN') {
      const parsed = reopenReasonSchema.safeParse(reason);
      if (!parsed.success) {
        setError(parsed.error.issues[0]!.message);
        return;
      }
      body = { action, payload: { reason: parsed.data } };
    } else {
      body = { action };
    }
    transition.mutate(
      { fitmentId: fitment.id, body },
      {
        onSuccess: () => {
          toast.success(`${fitment.tkId} ${copy.done}`);
          onClose();
        },
        onError: (err) => {
          const message = err instanceof ApiError ? err.message : `Could not ${copy.title.toLowerCase()} ${fitment.tkId}`;
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
            {copy.title} {fitment.tkId}?
          </DialogTitle>
          <DialogDescription>{description(action, fitment, actor)}</DialogDescription>
        </DialogHeader>
        <form
          className="grid grid-cols-1 gap-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {action === 'REOPEN' && (
            <div className="grid grid-cols-1 gap-2">
              <Label htmlFor="reopen-reason">Reason for reopening</Label>
              <Textarea
                id="reopen-reason"
                value={reason}
                maxLength={500}
                rows={3}
                aria-invalid={!!error}
                placeholder="What needs to be redone?"
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
