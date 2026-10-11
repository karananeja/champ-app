import { useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, FlaskConical, Loader2 } from 'lucide-react';
import {
  FITMENT_ACTION_LABELS,
  FITMENT_STATUS_LABELS,
  canTransition,
  type SimulateInput,
  type TaskDto,
  type TechnicianAction,
} from '@champ/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useLookups } from '../../masters/queries';
import { useSimulateTechnician } from './queries';

/** Marker checked by the production-bundle test: this text must never reach a production build (D-073). */
export const SIMULATOR_TITLE = 'Simulate technician (dev only)';

const STEPS: TechnicianAction[] = ['START', 'SUBMIT', 'CLOSE_NOT_DONE', 'MARK_FAULTY'];

/**
 * Dev-only technician simulator (D-073): performs Start, Submit, Close not done and Mark faulty as the
 * fitment's assigned technician through `POST /dev/fitments/:fid/simulate`. Loaded lazily and only when
 * `import.meta.env.DEV`, so production builds don't contain it.
 */
export default function SimulatorPanel({ task }: { task: TaskDto }) {
  const [open, setOpen] = useState(false);
  const candidates = task.fitments.filter((f) => f.technician);
  const [fitmentId, setFitmentId] = useState<string | null>(null);
  const [form, setForm] = useState<'CLOSE_NOT_DONE' | 'MARK_FAULTY' | null>(null);
  const [closeReasonId, setCloseReasonId] = useState('');
  const [comments, setComments] = useState('');
  const [faultReason, setFaultReason] = useState('');
  const lookups = useLookups();
  const simulate = useSimulateTechnician();
  const fitment = candidates.find((f) => f.id === fitmentId) ?? candidates[0];

  const run = (body: SimulateInput) => {
    if (!fitment) return;
    simulate.mutate(
      { fitmentId: fitment.id, body },
      {
        onSuccess: (res) => {
          toast.success(`${fitment.tkId}: ${FITMENT_STATUS_LABELS[res.fitment.status]} (simulated)`);
          setForm(null);
          setComments('');
          setFaultReason('');
        },
        onError: (err) => toast.error(err instanceof ApiError ? err.message : 'The simulated step failed'),
      },
    );
  };

  const click = (action: TechnicianAction) => {
    if (action === 'START' || action === 'SUBMIT') run({ action });
    else setForm(action);
  };

  return (
    <Card className="gap-3 border-dashed border-amber-300 bg-amber-50/40" data-testid="simulator-panel">
      <CardHeader>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 text-left"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="grid gap-1">
            <CardTitle className="flex items-center gap-2">
              <FlaskConical className="size-4" /> {SIMULATOR_TITLE}
            </CardTitle>
            <CardDescription>Acts as the assigned technician until the mobile app exists.</CardDescription>
          </span>
          <ChevronDown className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')} />
        </button>
      </CardHeader>
      {open && (
        <CardContent className="grid grid-cols-1 gap-3">
          {!fitment ? (
            <p className="text-sm text-muted-foreground">Assign a technician to a fitment first.</p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-2 sm:max-w-sm">
                <Label htmlFor="sim-fitment">Fitment</Label>
                <Select value={fitment.id} onValueChange={(v) => { setFitmentId(v); setForm(null); }}>
                  <SelectTrigger id="sim-fitment" aria-label="Fitment to simulate" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {candidates.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.tkId} · {f.technician!.name} · {FITMENT_STATUS_LABELS[f.status]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap gap-2">
                {STEPS.map((action) => (
                  <Button
                    key={action}
                    variant="outline"
                    size="sm"
                    disabled={!canTransition(action, fitment.status) || simulate.isPending}
                    onClick={() => click(action)}
                  >
                    {simulate.isPending && simulate.variables?.body.action === action && <Loader2 className="animate-spin" />}
                    {action === 'CLOSE_NOT_DONE' ? 'Close not done' : FITMENT_ACTION_LABELS[action]}
                  </Button>
                ))}
              </div>
              {form === 'CLOSE_NOT_DONE' && (
                <form
                  className="grid grid-cols-1 gap-2 sm:max-w-md"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run({ action: 'CLOSE_NOT_DONE', payload: { closeReasonId, comments } });
                  }}
                >
                  <Label htmlFor="sim-close-reason">Close reason</Label>
                  <Select value={closeReasonId} onValueChange={setCloseReasonId}>
                    <SelectTrigger id="sim-close-reason" aria-label="Close reason" className="w-full">
                      <SelectValue placeholder="Choose a close reason" />
                    </SelectTrigger>
                    <SelectContent>
                      {(lookups.data?.closeReasons ?? []).map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Label htmlFor="sim-comments">Comments</Label>
                  <Textarea id="sim-comments" value={comments} maxLength={1000} rows={2} onChange={(e) => setComments(e.target.value)} />
                  <Button type="submit" size="sm" disabled={!closeReasonId || !comments.trim() || simulate.isPending}>
                    Confirm close not done
                  </Button>
                </form>
              )}
              {form === 'MARK_FAULTY' && (
                <form
                  className="grid grid-cols-1 gap-2 sm:max-w-md"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run({ action: 'MARK_FAULTY', payload: { reason: faultReason } });
                  }}
                >
                  <Label htmlFor="sim-fault">Fault reason</Label>
                  <Input id="sim-fault" value={faultReason} maxLength={500} onChange={(e) => setFaultReason(e.target.value)} />
                  <Button type="submit" size="sm" disabled={!faultReason.trim() || simulate.isPending}>
                    Confirm mark faulty
                  </Button>
                </form>
              )}
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}
