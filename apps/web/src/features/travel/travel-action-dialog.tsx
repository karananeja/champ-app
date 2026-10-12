import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { travelReasonSchema, type TravelTaskDto } from '@champ/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { useTravelTransition } from './queries';

/** The actions confirmed with this dialog (Resubmit opens the edit form instead). */
export type TravelReviewAction = 'VERIFY' | 'REJECT' | 'REOPEN';

const COPY: Record<TravelReviewAction, { title: string; confirm: string; done: string; description: string; reason?: string; placeholder?: string }> = {
  VERIFY: {
    title: 'Verify',
    confirm: 'Verify',
    done: 'verified',
    description: 'Confirms the trip for reimbursement. A verified travel task is locked; only an operations manager can reopen it.',
  },
  REJECT: {
    title: 'Reject',
    confirm: 'Reject',
    done: 'rejected',
    description: 'Sends it back to the person who raised it, who can fix it and resubmit. The reason stays in the history.',
    reason: 'Reason for rejecting',
    placeholder: 'What is wrong or missing?',
  },
  REOPEN: {
    title: 'Reopen',
    confirm: 'Reopen',
    done: 'reopened',
    description: 'Makes it Raised again so it can be corrected and verified anew. The earlier verification stays in the history.',
    reason: 'Reason for reopening',
    placeholder: 'What mistake was found?',
  },
};

/**
 * Confirms Verify, or asks the reason (3–500 characters, the shared schema) for Reject and Reopen, then runs the
 * transition. Server refusals (e.g. 409 when someone else acted first) are shown verbatim.
 */
export function TravelActionDialog({ tt, action, onClose }: { tt: Pick<TravelTaskDto, 'id' | 'ttId'>; action: TravelReviewAction; onClose: () => void }) {
  const copy = COPY[action];
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const transition = useTravelTransition();

  const submit = () => {
    setError(null);
    let body: Parameters<typeof transition.mutate>[0]['body'];
    if (action === 'VERIFY') {
      body = { action };
    } else {
      const parsed = travelReasonSchema.safeParse(reason);
      if (!parsed.success) {
        setError(parsed.error.issues[0]!.message);
        return;
      }
      body = { action, reason: parsed.data };
    }
    transition.mutate(
      { id: tt.id, body },
      {
        onSuccess: () => {
          toast.success(`${tt.ttId} ${copy.done}`);
          onClose();
        },
        onError: (err) => setError(err instanceof ApiError ? err.message : `Could not ${copy.title.toLowerCase()} ${tt.ttId}`),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {copy.title} {tt.ttId}?
          </DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid grid-cols-1 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {copy.reason && (
            <div className="grid grid-cols-1 gap-2">
              <Label htmlFor="travel-reason">{copy.reason}</Label>
              <Textarea
                id="travel-reason"
                rows={3}
                maxLength={500}
                value={reason}
                placeholder={copy.placeholder}
                aria-invalid={!!error}
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
            <Button type="submit" variant={action === 'REJECT' ? 'destructive' : 'default'} disabled={transition.isPending}>
              {transition.isPending && <Loader2 className="animate-spin" />} {copy.confirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
