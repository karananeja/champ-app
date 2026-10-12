import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CheckCheck, Pencil, RotateCcw, Send, XCircle } from 'lucide-react';
import { TRAVEL_SOURCE_LABELS, TECHNICIAN_TYPE_LABELS, type TravelAction } from '@champ/shared';
import { ErrorState } from '@/components/empty-state';
import { TravelStatusBadge } from '@/components/fitment-status-badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDay } from '@/lib/dates';
import { formatIst } from '@/lib/format';
import { keepOpenForLightbox } from '../tasks/verification/photo-meta';
import { useTravelTask } from './queries';
import { TravelActionDialog, type TravelReviewAction } from './travel-action-dialog';
import { TravelFormDialog, type TravelFormMode } from './travel-form-dialog';
import { TravelHistory } from './travel-history';
import { TravelReceipts } from './travel-receipts';

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2 grid gap-0.5' : 'grid gap-0.5'}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words whitespace-pre-line">{children}</dd>
    </div>
  );
}

const ACTION_ICONS: Record<TravelAction, typeof CheckCheck> = { VERIFY: CheckCheck, REJECT: XCircle, RESUBMIT: Send, REOPEN: RotateCcw };
const ACTION_LABELS: Record<TravelAction, string> = { VERIFY: 'Verify', REJECT: 'Reject', RESUBMIT: 'Resubmit', REOPEN: 'Reopen' };

/**
 * The detail of a TT (F08): a sheet (full screen on phones) with every field, the receipts (images in the F06
 * lightbox, PDFs as chips), the history, and the buttons the server allows (`availableActions`): Verify
 * (confirm), Reject (reason), Resubmit (the edit form, then resubmit) and Reopen (reason); Edit when `canEdit`.
 */
export function TravelDetailSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: tt, isPending, isError, error, refetch } = useTravelTask(id);
  const [action, setAction] = useState<TravelReviewAction | null>(null);
  const [form, setForm] = useState<TravelFormMode | null>(null);

  const run = (a: TravelAction) => {
    if (!tt) return;
    if (a === 'RESUBMIT') setForm({ kind: 'resubmit', tt });
    else setAction(a);
  };

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-xl" data-testid="travel-detail" onEscapeKeyDown={keepOpenForLightbox}>
        <SheetHeader className="border-b pr-12">
          <SheetTitle className="font-mono text-lg">{tt?.ttId ?? 'Travel task'}</SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-2">
            {tt && <TravelStatusBadge status={tt.status} />}
            {tt && (
              <span>
                Raised by {tt.raisedBy.name} · {formatIst(tt.createdAt)} · {TRAVEL_SOURCE_LABELS[tt.source]}
              </span>
            )}
          </SheetDescription>
        </SheetHeader>
        {isPending ? (
          <div role="status" aria-busy="true" aria-label="Loading" className="grid gap-3 p-4">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : isError ? (
          <div className="p-4">
            <ErrorState error={error} size="sm" onRetry={() => void refetch()} />
          </div>
        ) : (
          <div className="grid gap-4 p-4">
            {(tt.availableActions.length > 0 || tt.canEdit) && (
              <div className="flex flex-wrap gap-2" data-testid="travel-actions">
                {tt.availableActions.map((a) => {
                  const Icon = ACTION_ICONS[a];
                  return (
                    <Button key={a} size="sm" variant={a === 'REJECT' ? 'outline' : 'default'} onClick={() => run(a)}>
                      <Icon /> {ACTION_LABELS[a]}
                    </Button>
                  );
                })}
                {tt.canEdit && !tt.availableActions.includes('RESUBMIT') && (
                  <Button size="sm" variant="outline" onClick={() => setForm({ kind: 'edit', tt })}>
                    <Pencil /> Edit
                  </Button>
                )}
              </div>
            )}
            {tt.status === 'REJECTED' && tt.rejectionReason && (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm" data-testid="rejection">
                Rejected by {tt.rejectedBy?.name ?? 'someone'}
                {tt.rejectedAt && ` · ${formatIst(tt.rejectedAt)}`}: {tt.rejectionReason}
              </p>
            )}
            <dl className="grid grid-cols-2 gap-3">
              <Field label="Technician">
                {tt.technician.name}
                {tt.technician.technicianType && <span className="text-muted-foreground"> · {TECHNICIAN_TYPE_LABELS[tt.technician.technicianType]}</span>}
              </Field>
              <Field label="Operation executive">{tt.oe?.name ?? '—'}</Field>
              <Field label="Travel date">{formatDay(tt.travelDate)}</Field>
              <Field label="Location">
                {tt.location.city}
                {!tt.location.active && ' (inactive)'}
              </Field>
              <Field label="Customer">{tt.client ? `${tt.client.name}${tt.client.active ? '' : ' (inactive)'}` : '—'}</Field>
              <Field label="Distance">{tt.distanceKm === null ? '—' : `${tt.distanceKm} km`}</Field>
              <Field label="Related task">
                {tt.relatedFitment ? (
                  <Link to={`/tasks/${tt.relatedFitment.taskId}`} className="font-mono hover:underline">
                    {tt.relatedFitment.tkId}
                  </Link>
                ) : (
                  '—'
                )}
                {tt.relatedFitment && (
                  <span className="text-muted-foreground">
                    {' '}
                    · {tt.relatedFitment.omId} · {tt.relatedFitment.client}
                  </span>
                )}
              </Field>
              {tt.verifiedAt && <Field label="Verified">{`${tt.verifiedBy?.name ?? ''} · ${formatIst(tt.verifiedAt)}`}</Field>}
              <Field label="Purpose of travel" wide>
                {tt.purpose}
              </Field>
            </dl>
            <Separator />
            <section className="grid gap-2" aria-labelledby="travel-receipts-heading">
              <h3 id="travel-receipts-heading" className="text-sm font-medium">
                Receipts ({tt.attachments.length})
              </h3>
              <TravelReceipts tt={tt} />
            </section>
            <Separator />
            <section className="grid gap-2" aria-labelledby="travel-history-heading">
              <h3 id="travel-history-heading" className="text-sm font-medium">
                History
              </h3>
              <TravelHistory events={tt.events} />
            </section>
          </div>
        )}
        {tt && action && <TravelActionDialog tt={tt} action={action} onClose={() => setAction(null)} />}
        {form && <TravelFormDialog mode={form} onClose={() => setForm(null)} />}
      </SheetContent>
    </Sheet>
  );
}
