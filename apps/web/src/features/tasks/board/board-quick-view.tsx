import { Link } from 'react-router-dom';
import { ExternalLink, RotateCcw, UserCog, CheckCheck } from 'lucide-react';
import { isFitmentAssignable, type BoardCard, type BoardMoveKind } from '@champ/shared';
import { ErrorState } from '@/components/empty-state';
import { FitmentStatusBadge } from '@/components/fitment-status-badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { formatIst } from '@/lib/format';
import { WorkflowInfo } from '../fitments-section';
import { useTask } from '../queries';
import { PhotoGallery } from '../verification/photo-gallery';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  );
}

/**
 * The quick view of a board card (F07): a sheet (full screen on phones) with the fitment summary, technician,
 * the verification summary and photos (F06 gallery and lightbox), the actions the server allows (Change
 * technician, Final approve, Reopen) and a link to the task. It reads the task (`GET /tasks/:id`) for the
 * fitment's details and permissions.
 */
export function BoardQuickView({
  card,
  onClose,
  onAction,
}: {
  card: BoardCard;
  onClose: () => void;
  /** Starts a move from the quick view (the board shows the dialog). */
  onAction: (kind: BoardMoveKind, card: BoardCard, currentTechnicianId: string | null) => void;
}) {
  const { data: task, isPending, isError, error, refetch } = useTask(card.task.id);
  const fitment = task?.fitments.find((f) => f.id === card.id);

  const canChangeTechnician = !!task && !!fitment && task.permissions.canAssign && isFitmentAssignable(fitment.status);
  const canApprove = !!fitment?.availableActions.includes('APPROVE');
  const canReopen = !!fitment?.availableActions.includes('REOPEN');

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-lg" data-testid="board-quick-view">
        <SheetHeader className="border-b pr-12">
          <SheetTitle className="font-mono text-lg">{card.tkId}</SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-2">
            <FitmentStatusBadge status={fitment?.status ?? card.status} />
            <span>
              {card.task.omId} · {card.task.oeTaskId}
            </span>
          </SheetDescription>
        </SheetHeader>
        <div className="grid gap-4 p-4">
          <dl className="grid grid-cols-2 gap-3">
            <Field label="Customer">{card.client.name}</Field>
            <Field label="City">{card.city}</Field>
            <Field label="Activity">{card.activity.name}</Field>
            <Field label="Fitment date (IST)">{formatIst(card.fitmentAt)}</Field>
            <Field label="Technician">{fitment ? (fitment.technician?.name ?? 'Unassigned') : (card.technician?.name ?? 'Unassigned')}</Field>
            {task && <Field label="Operation executive">{task.oe.name}</Field>}
            {fitment?.vehicleRegNo && <Field label="Vehicle">{fitment.vehicleRegNo}</Field>}
            {task && <Field label="Site">{task.site.name}</Field>}
          </dl>

          {isPending ? (
            <div role="status" aria-busy="true" aria-label="Loading" className="grid gap-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : isError ? (
            <ErrorState error={error} size="sm" onRetry={() => void refetch()} />
          ) : !fitment ? (
            <p className="text-sm text-muted-foreground">This fitment is no longer part of the task.</p>
          ) : (
            <>
              <WorkflowInfo f={fitment} />
              {fitment.verification.issueObserved && (
                <dl className="grid grid-cols-1 gap-2 rounded-md border p-3" data-testid="quick-view-verification">
                  <Field label="Issue observed">{fitment.verification.issueObserved.name}</Field>
                  {fitment.verification.actionTaken && <Field label="Action taken">{fitment.verification.actionTaken.name}</Field>}
                  {fitment.verification.oeRemarks && <Field label="OE remarks">{fitment.verification.oeRemarks}</Field>}
                </dl>
              )}
              {fitment.photoCounts.active > 0 && (
                <div className="grid gap-2">
                  <h3 className="text-sm font-medium">Photos ({fitment.photoCounts.active})</h3>
                  <PhotoGallery fitmentId={fitment.id} manage={false} allowHistory={false} compact />
                </div>
              )}
              <Separator />
              <div className="flex flex-wrap gap-2">
                {canChangeTechnician && (
                  <Button variant="outline" onClick={() => onAction('ASSIGN', card, fitment.technician?.id ?? null)}>
                    <UserCog /> Change technician
                  </Button>
                )}
                {canApprove && (
                  <Button onClick={() => onAction('APPROVE', card, null)}>
                    <CheckCheck /> Final approve
                  </Button>
                )}
                {canReopen && (
                  <Button variant="outline" onClick={() => onAction('REOPEN', card, null)}>
                    <RotateCcw /> Reopen
                  </Button>
                )}
              </div>
            </>
          )}
          <Button asChild variant="link" className="justify-self-start px-0">
            <Link to={`/tasks/${card.task.id}`}>
              <ExternalLink /> Open task {card.task.omId}
            </Link>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
