import { useState } from 'react';
import { toast } from 'sonner';
import { CheckCheck, ClipboardCheck, Images, Loader2, MoreHorizontal, Pencil, RotateCcw } from 'lucide-react';
import {
  FITMENT_ACTION_LABELS,
  FITMENT_STATUS_LABELS,
  REVIEW_ACTIONS,
  isFitmentAssignable,
  type FitmentDto,
  type TaskDto,
  type UpdateFitmentInput,
} from '@champ/shared';
import { FitmentStatusBadge } from '@/components/fitment-status-badge';
import { SearchableSelect } from '@/components/searchable-select';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ApiError } from '@/lib/api';
import { useCurrentUser } from '@/lib/auth';
import { FitmentActionDialog, type ReviewAction } from './fitment-action-dialog';
import { useApproveFitments, useAssignFitments, useTaskOptions, useUpdateFitment } from './queries';
import { TONES } from '@/lib/tones';
import { cn } from '@/lib/utils';
import { BillableBadge } from './verification/billable-badge';
import { PhotoViewerDialog } from './verification/photo-viewer-dialog';
import { VerificationSheet } from './verification/verification-sheet';

const vehicleText = (f: FitmentDto) =>
  [f.vehicleRegNo, f.chassisNo && `Chassis ${f.chassisNo}`, f.assetNumber && `Asset ${f.assetNumber}`, f.oldDeviceId && `Old device ${f.oldDeviceId}`]
    .filter(Boolean)
    .join(' · ') || '—';

/** The review actions (Final approve, Reopen) the server says the caller may take; Verify opens the sheet (F06). */
const reviewActions = (f: FitmentDto) =>
  f.availableActions.filter((a): a is ReviewAction => a !== 'VERIFY' && REVIEW_ACTIONS.includes(a));

/** Statuses whose verification is worth opening (being verified, verified or approved). */
const VERIFICATION_STATUSES: readonly FitmentDto['status'][] = ['SUBMITTED', 'OE_VERIFIED', 'OM_APPROVED'];

/**
 * The verification button of a fitment (F06): "Verify" when the caller may verify it, else "Edit verification"
 * or "View verification" by the server's flags; null when there is nothing to verify yet.
 */
function verificationLabel(f: FitmentDto): string | null {
  if (f.availableActions.includes('VERIFY')) return FITMENT_ACTION_LABELS.VERIFY;
  if (!VERIFICATION_STATUSES.includes(f.status)) return null;
  return f.canEditVerification ? 'Edit verification' : 'View verification';
}

/** "Photos (5)" when there are photos or the caller may add one. */
const showPhotos = (f: FitmentDto) => f.photoCounts.active > 0 || f.canManagePhotos;

/** Scrolls to the visible row or card of a fitment (replacement links). */
function scrollToFitment(tkId: string) {
  const target = Array.from(document.querySelectorAll<HTMLElement>(`[data-tk="${tkId}"]`)).find((el) => el.offsetParent !== null);
  target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target?.focus({ preventScroll: true });
}

/** Replacement links, the reopen count, and the close or fault reason, shown under the vehicle (F05). */
function WorkflowInfo({ f }: { f: FitmentDto }) {
  const link = (tkId: string) => (
    <button type="button" className="font-mono underline underline-offset-2" onClick={() => scrollToFitment(tkId)}>
      {tkId}
    </button>
  );
  return (
    <div className="mt-1 grid grid-cols-1 gap-1 text-xs text-muted-foreground" data-testid="fitment-workflow-info">
      {f.replacementOf && <div>Replacement for {link(f.replacementOf.tkId)}</div>}
      {f.replacement && (
        <div>
          Replaced by {link(f.replacement.tkId)} ({FITMENT_STATUS_LABELS[f.replacement.status]})
        </div>
      )}
      {f.status === 'MOVED_TO_FT' && f.faultReason && <div className="break-words">Fault: {f.faultReason}</div>}
      {f.status === 'CLOSED_NOT_DONE' && f.closeReason && (
        <div className="break-words">
          Not done: {f.closeReason.name}
          {f.closeComments && ` — ${f.closeComments}`}
        </div>
      )}
      {(f.status === 'OE_VERIFIED' || f.status === 'OM_APPROVED') && f.verification.finalIssue && (
        <div className="flex flex-wrap items-center gap-1" data-testid="fitment-verification">
          <span className="break-words">Final issue: {f.verification.finalIssue.name}</span>
          <BillableBadge billable={f.verification.billable} />
        </div>
      )}
      {f.reopenCount > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant="outline" className={cn('gap-1', TONES.orange)} data-testid="reopen-chip">
            <RotateCcw className="size-3" /> Reopened ×{f.reopenCount}
          </Badge>
          {f.lastReopenReason && <span className="break-words">{f.lastReopenReason}</span>}
        </div>
      )}
    </div>
  );
}

/**
 * The fitments of a task: status badges, per-row review actions (Verify opens the verification sheet, F06;
 * Final approve, Reopen) from the server's `availableActions`, Photos and the verification summary, checkboxes for bulk assign/unassign (Open/Assigned/Reopened) and bulk final
 * approve (OE-verified, OM/SA), and the vehicle editor under the edit locks. Rows become cards with an
 * actions menu on phones.
 */
export function FitmentsSection({ task }: { task: TaskDto }) {
  const actor = useCurrentUser();
  const manage = task.permissions.canAssign;
  const assignable = (f: FitmentDto) => manage && isFitmentAssignable(f.status);
  const approvable = (f: FitmentDto) => f.availableActions.includes('APPROVE');
  const selectable = task.fitments.filter((f) => assignable(f) || approvable(f));
  const editable = (f: FitmentDto) => f.canEditData;
  const hasActionsColumn = task.fitments.some((f) => reviewActions(f).length > 0 || editable(f) || verificationLabel(f) || showPhotos(f));

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [technicianId, setTechnicianId] = useState<string | null>(null);
  const [editing, setEditing] = useState<FitmentDto | null>(null);
  const [acting, setActing] = useState<{ fitment: FitmentDto; action: ReviewAction } | null>(null);
  // F06: open the verification sheet or the photo viewer by id, so they follow refreshed fitment data.
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [photosId, setPhotosId] = useState<string | null>(null);
  const verifying = task.fitments.find((f) => f.id === verifyingId);
  const viewingPhotos = task.fitments.find((f) => f.id === photosId);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const options = useTaskOptions();
  const assign = useAssignFitments(task.id);
  const approve = useApproveFitments();

  // Drop selections that are no longer selectable (e.g. after a refresh).
  const chosen = selectable.filter((f) => selected.has(f.id));
  const toAssign = chosen.filter(assignable).map((f) => f.id);
  const toApprove = chosen.filter(approvable);
  const allChecked = chosen.length > 0 && chosen.length === selectable.length;
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const toggleAll = (on: boolean) => setSelected(on ? new Set(selectable.map((f) => f.id)) : new Set());

  const runAssign = (target: string | null) => {
    const name = options.data?.technicians.find((t) => t.id === target)?.name;
    assign.mutate(
      { fitmentIds: toAssign, technicianId: target },
      {
        onSuccess: () => {
          toast.success(target ? `Assigned ${toAssign.length} fitment(s) to ${name}` : `Unassigned ${toAssign.length} fitment(s)`);
          setSelected(new Set());
        },
        onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Could not update the assignment'),
      },
    );
  };

  const runApprove = () =>
    approve.mutate(
      toApprove.map((f) => f.id),
      {
        onSuccess: ({ approved, failed }) => {
          if (approved.length) toast.success(`Final-approved ${approved.length} fitment(s)`);
          for (const f of failed) toast.error(`${f.tkId}: ${f.message}`);
          setSelected(new Set());
          setConfirmApprove(false);
        },
        onError: (err) => {
          toast.error(err instanceof ApiError ? err.message : 'Could not approve the fitments');
          setConfirmApprove(false);
        },
      },
    );

  const checkbox = (f: FitmentDto) =>
    selectable.includes(f) ? (
      <Checkbox aria-label={`Select ${f.tkId}`} checked={selected.has(f.id)} onCheckedChange={(v) => toggle(f.id, v === true)} />
    ) : null;

  const actionButtons = (f: FitmentDto) => (
    <div className="flex flex-wrap justify-end gap-1">
      {showPhotos(f) && (
        <Button size="sm" variant="outline" onClick={() => setPhotosId(f.id)} aria-label={`Photos ${f.tkId}`}>
          <Images /> Photos ({f.photoCounts.active})
        </Button>
      )}
      {verificationLabel(f) && (
        <Button
          size="sm"
          variant={f.availableActions.includes('VERIFY') ? 'default' : 'outline'}
          onClick={() => setVerifyingId(f.id)}
          aria-label={`${verificationLabel(f)} ${f.tkId}`}
        >
          {!f.availableActions.includes('VERIFY') && <ClipboardCheck />} {verificationLabel(f)}
        </Button>
      )}
      {reviewActions(f).map((action) => (
        <Button
          key={action}
          size="sm"
          variant={action === 'REOPEN' ? 'outline' : 'default'}
          onClick={() => setActing({ fitment: f, action })}
          aria-label={`${FITMENT_ACTION_LABELS[action]} ${f.tkId}`}
        >
          {FITMENT_ACTION_LABELS[action]}
        </Button>
      ))}
      {editable(f) && (
        <Button variant="ghost" size="icon-sm" aria-label={`Edit vehicle ${f.tkId}`} onClick={() => setEditing(f)}>
          <Pencil />
        </Button>
      )}
    </div>
  );

  const actionsMenu = (f: FitmentDto) => {
    const actions = reviewActions(f);
    const verification = verificationLabel(f);
    if (!actions.length && !editable(f) && !verification && !showPhotos(f)) return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon-sm" aria-label={`Actions for ${f.tkId}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {verification && <DropdownMenuItem onSelect={() => setVerifyingId(f.id)}>{verification}</DropdownMenuItem>}
          {showPhotos(f) && <DropdownMenuItem onSelect={() => setPhotosId(f.id)}>Photos ({f.photoCounts.active})</DropdownMenuItem>}
          {actions.map((action) => (
            <DropdownMenuItem key={action} onSelect={() => setActing({ fitment: f, action })}>
              {FITMENT_ACTION_LABELS[action]}
            </DropdownMenuItem>
          ))}
          {editable(f) && <DropdownMenuItem onSelect={() => setEditing(f)}>Edit vehicle</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>Fitments</CardTitle>
        <CardDescription data-testid="fitment-counts">
          {task.counts.total} total · {task.counts.assigned} assigned · {task.counts.open} open
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4">
        {selectable.length > 0 && (
          <div className="grid grid-cols-1 gap-2 rounded-md border bg-muted/40 p-3 sm:flex sm:flex-wrap sm:items-center">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                aria-label="Select all fitments"
                checked={allChecked ? true : chosen.length > 0 ? 'indeterminate' : false}
                onCheckedChange={(v) => toggleAll(v === true)}
              />
              <span data-testid="selected-count">{chosen.length} selected</span>
            </label>
            {manage && selectable.some(assignable) && (
              <>
                <SearchableSelect
                  aria-label="Technician to assign"
                  className="sm:w-64"
                  value={technicianId}
                  onChange={setTechnicianId}
                  options={(options.data?.technicians ?? []).map((t) => ({ value: t.id, label: t.name, hint: t.baseLocation ?? undefined }))}
                  placeholder="Choose a technician"
                  searchPlaceholder="Search technician"
                />
                <div className="flex gap-2">
                  <Button disabled={!toAssign.length || !technicianId || assign.isPending} onClick={() => runAssign(technicianId)}>
                    {assign.isPending && <Loader2 className="animate-spin" />} Assign
                  </Button>
                  <Button variant="outline" disabled={!toAssign.length || assign.isPending} onClick={() => runAssign(null)}>
                    Unassign
                  </Button>
                </div>
              </>
            )}
            {selectable.some(approvable) && (
              <Button disabled={!toApprove.length || approve.isPending} onClick={() => setConfirmApprove(true)}>
                <CheckCheck /> Final approve{toApprove.length ? ` (${toApprove.length})` : ''}
              </Button>
            )}
          </div>
        )}

        <div className="hidden rounded-md border md:block">
          <Table>
            <TableHeader>
              <TableRow>
                {selectable.length > 0 && (
                  <TableHead className="w-10">
                    <span className="sr-only">Select</span>
                  </TableHead>
                )}
                <TableHead>TK id</TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead>Technician</TableHead>
                <TableHead>Status</TableHead>
                {hasActionsColumn && (
                  <TableHead className="text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {task.fitments.map((f) => (
                <TableRow key={f.id} data-testid="fitment-row" data-status={f.status} data-tk={f.tkId} tabIndex={-1}>
                  {selectable.length > 0 && <TableCell>{checkbox(f)}</TableCell>}
                  <TableCell className="font-mono">{f.tkId}</TableCell>
                  <TableCell className="whitespace-normal">
                    {vehicleText(f)}
                    <WorkflowInfo f={f} />
                  </TableCell>
                  <TableCell data-testid="fitment-technician">{f.technician?.name ?? '—'}</TableCell>
                  <TableCell>
                    <FitmentStatusBadge status={f.status} />
                  </TableCell>
                  {hasActionsColumn && <TableCell>{actionButtons(f)}</TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <ul className="grid grid-cols-1 gap-2 md:hidden">
          {task.fitments.map((f) => (
            <li
              key={f.id}
              data-testid="fitment-card"
              data-status={f.status}
              data-tk={f.tkId}
              tabIndex={-1}
              className="flex items-start gap-3 rounded-md border p-3"
            >
              {selectable.length > 0 && <div className="pt-0.5">{checkbox(f)}</div>}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono font-medium">{f.tkId}</span>
                  <FitmentStatusBadge status={f.status} />
                </div>
                <div className="mt-1 text-sm break-words text-muted-foreground">{vehicleText(f)}</div>
                <div className="text-sm" data-testid="fitment-technician">
                  {f.technician?.name ?? 'No technician'}
                </div>
                <WorkflowInfo f={f} />
              </div>
              {actionsMenu(f)}
            </li>
          ))}
        </ul>
      </CardContent>
      {editing && <VehicleDialog taskId={task.id} fitment={editing} onClose={() => setEditing(null)} />}
      {acting && <FitmentActionDialog fitment={acting.fitment} action={acting.action} actor={actor} onClose={() => setActing(null)} />}
      {verifying && <VerificationSheet key={verifying.id} fitment={verifying} onClose={() => setVerifyingId(null)} />}
      {viewingPhotos && <PhotoViewerDialog fitment={viewingPhotos} onClose={() => setPhotosId(null)} />}
      <AlertDialog open={confirmApprove} onOpenChange={setConfirmApprove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Final approve {toApprove.length} fitment(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              {toApprove.map((f) => f.tkId).join(', ')} become OM approved. After this only an OM can change them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={approve.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={approve.isPending}
              onClick={(e) => {
                e.preventDefault();
                runApprove();
              }}
            >
              Final approve
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

const VEHICLE_FIELDS: { key: keyof UpdateFitmentInput; label: string }[] = [
  { key: 'vehicleRegNo', label: 'Registration number' },
  { key: 'chassisNo', label: 'Chassis number' },
  { key: 'assetNumber', label: 'Asset number' },
  { key: 'oldDeviceId', label: 'Old device id' },
];

function VehicleDialog({ taskId, fitment, onClose }: { taskId: string; fitment: FitmentDto; onClose: () => void }) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(VEHICLE_FIELDS.map(({ key }) => [key, fitment[key] ?? ''])) as Record<keyof UpdateFitmentInput, string>,
  );
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateFitment(taskId);
  const save = () => {
    setError(null);
    update.mutate(
      { fitmentId: fitment.id, body: values },
      {
        onSuccess: () => {
          toast.success(`${fitment.tkId} saved`);
          onClose();
        },
        onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not save'),
      },
    );
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Vehicle for {fitment.tkId}</DialogTitle>
          <DialogDescription>
            {fitment.status === 'OM_APPROVED'
              ? 'This fitment is OM approved: your change is flagged in the history.'
              : 'All fields are optional; the technician can complete them on site.'}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid grid-cols-1 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          {VEHICLE_FIELDS.map(({ key, label }) => (
            <div key={key} className="grid grid-cols-1 gap-2">
              <Label htmlFor={`vehicle-${key}`}>{label}</Label>
              <Input
                id={`vehicle-${key}`}
                value={values[key]}
                maxLength={50}
                onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
              />
            </div>
          ))}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending && <Loader2 className="animate-spin" />} Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
