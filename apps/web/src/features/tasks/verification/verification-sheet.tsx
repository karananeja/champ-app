import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import {
  VERIFICATION_FIELD_LABELS,
  missingVerificationFields,
  verificationFieldMessage,
  type FitmentDto,
  type LookupOption,
  type TaskRef,
  type UpdateVerificationInput,
  type VerificationRequiredField,
} from '@champ/shared';
import { FitmentStatusBadge } from '@/components/fitment-status-badge';
import { SearchableSelect, type SelectOption } from '@/components/searchable-select';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { formatIst } from '@/lib/format';
import { useLookups } from '../../masters/queries';
import { BillableBadge } from './billable-badge';
import { PhotoGallery } from './photo-gallery';
import { keepOpenForLightbox } from './photo-meta';
import { DebugPhotoUpload } from './photo-upload';
import { useSaveVerification, useVerifyFitment } from './queries';

interface FormState {
  issueObservedId: string | null;
  actionTakenId: string | null;
  accessoryIds: string[];
  oeRemarks: string;
  finalIssueId: string | null;
}

const initialForm = (f: FitmentDto): FormState => ({
  issueObservedId: f.verification.issueObserved?.id ?? null,
  actionTakenId: f.verification.actionTaken?.id ?? null,
  accessoryIds: f.verification.accessories.map((a) => a.id),
  oeRemarks: f.verification.oeRemarks ?? '',
  finalIssueId: f.verification.finalIssue?.id ?? null,
});

const toBody = (form: FormState): UpdateVerificationInput => ({
  issueObservedId: form.issueObservedId,
  actionTakenId: form.actionTakenId,
  accessoryIds: form.accessoryIds,
  oeRemarks: form.oeRemarks,
  finalIssueId: form.finalIssueId,
});

/** Active options, plus the saved value when it was deactivated since (shown as "(inactive)"). */
function optionsWith(active: readonly LookupOption[], saved: TaskRef | null): SelectOption[] {
  const options = active.map((o) => ({ value: o.id, label: o.name }));
  if (saved && !active.some((o) => o.id === saved.id)) options.push({ value: saved.id, label: `${saved.name} (inactive)` });
  return options;
}

const refText = (ref: TaskRef | null) => (ref ? (ref.active ? ref.name : `${ref.name} (inactive)`) : '—');

/**
 * The OE verification of one fitment (F06), replacing F05's Verify confirmation: a right-side sheet (full
 * screen on phones) with the technician's work on the left (info, OT remarks, photos) and the form on the
 * right (issue observed, action taken, accessories, OE remarks, debug image, final issue with a live billable
 * badge). Save draft keeps partial entries; Verify shows the missing required fields inline (D-098). Read-only
 * when the caller can't edit (OM viewing an approved lock, RO, SA, after the OE's lock).
 */
export function VerificationSheet({ fitment, onClose }: { fitment: FitmentDto; onClose: () => void }) {
  const canVerify = fitment.availableActions.includes('VERIFY');
  const editable = fitment.canEditVerification;
  const [form, setForm] = useState<FormState>(() => initialForm(fitment));
  const [errors, setErrors] = useState<Partial<Record<VerificationRequiredField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const lookups = useLookups();
  const save = useSaveVerification(fitment.id);
  const verify = useVerifyFitment(fitment.id);
  const busy = save.isPending || verify.isPending;
  const v = fitment.verification;

  const title = canVerify ? `Verify ${fitment.tkId}` : editable ? `Edit verification · ${fitment.tkId}` : `Verification · ${fitment.tkId}`;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFormError(null);
    if (key in errors) setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  // Live billable: the saved snapshot while the final issue is unchanged on a verified fitment, else the
  // chosen final issue's current flag (what verifying would snapshot, D-101).
  const chosenFinal = lookups.data?.finalIssues.find((f) => f.id === form.finalIssueId);
  const liveBillable = !form.finalIssueId
    ? null
    : form.finalIssueId === v.finalIssue?.id && v.billable !== null
      ? v.billable
      : (chosenFinal?.billable ?? (form.finalIssueId === v.finalIssue?.id ? v.finalIssue.billable : null));

  const fail = (err: unknown, fallback: string) => {
    if (err instanceof ApiError && err.code === 'VERIFICATION_INCOMPLETE') {
      const fields = err.fieldErrors as Partial<Record<VerificationRequiredField, string[]>>;
      setErrors(Object.fromEntries(Object.entries(fields).map(([k, m]) => [k, m?.[0]])));
    }
    const message = err instanceof ApiError ? err.message : fallback;
    setFormError(message);
    toast.error(message);
  };

  const onSave = () => {
    setFormError(null);
    save.mutate(toBody(form), {
      onSuccess: () => toast.success(canVerify ? `Draft saved for ${fitment.tkId}` : `Verification of ${fitment.tkId} saved`),
      onError: (err) => fail(err, 'Could not save the verification'),
    });
  };

  const onVerify = () => {
    setFormError(null);
    const missing = missingVerificationFields(form);
    if (missing.length) {
      setErrors(Object.fromEntries(missing.map((f) => [f, verificationFieldMessage(f)])));
      setFormError(`Fill in ${missing.map((f) => VERIFICATION_FIELD_LABELS[f]).join(', ')} before verifying`);
      return;
    }
    verify.mutate(toBody(form), {
      onSuccess: () => {
        toast.success(`${fitment.tkId} verified`);
        onClose();
      },
      onError: (err) => fail(err, `Could not verify ${fitment.tkId}`),
    });
  };

  const selectField = (key: 'issueObservedId' | 'actionTakenId' | 'finalIssueId', options: SelectOption[], extra?: ReactNode) => {
    const id = `verify-${key}`;
    return (
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label htmlFor={id}>
            {VERIFICATION_FIELD_LABELS[key]} <span className="text-destructive">*</span>
          </Label>
          {extra}
        </div>
        <SearchableSelect
          id={id}
          value={form[key]}
          onChange={(value) => set(key, value)}
          options={options}
          placeholder={`Choose the ${VERIFICATION_FIELD_LABELS[key].toLowerCase()}`}
          searchPlaceholder="Search"
          aria-invalid={!!errors[key]}
          disabled={busy}
        />
        {errors[key] && (
          <p className="text-sm text-destructive" data-testid={`error-${key}`}>
            {errors[key]}
          </p>
        )}
      </div>
    );
  };

  const accessories = optionsWith(lookups.data?.accessories ?? [], null);
  for (const a of v.accessories) if (!accessories.some((o) => o.value === a.id)) accessories.push({ value: a.id, label: `${a.name} (inactive)` });

  return (
    <Sheet open onOpenChange={(open) => !open && !busy && onClose()}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto p-0 sm:max-w-4xl"
        onEscapeKeyDown={keepOpenForLightbox}
        data-testid="verification-sheet"
      >
        <SheetHeader className="border-b pr-12">
          <SheetTitle className="font-mono text-lg">{title}</SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-2">
            <FitmentStatusBadge status={fitment.status} />
            <span>{fitment.vehicleRegNo ?? 'No registration number'}</span>
          </SheetDescription>
        </SheetHeader>

        <div className="grid grid-cols-1 gap-6 p-4 lg:grid-cols-2">
          <section className="grid min-w-0 content-start gap-4" aria-labelledby="verify-work">
            <h3 id="verify-work" className="font-semibold">
              Technician&apos;s work
            </h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Item label="Technician">{fitment.technician?.name ?? '—'}</Item>
              <Item label="Submitted (IST)">{fitment.submittedAt ? formatIst(fitment.submittedAt) : '—'}</Item>
            </dl>
            <div className="grid gap-1 text-sm">
              <div className="text-xs text-muted-foreground">Remarks from OT</div>
              <p className="rounded-md bg-muted/50 p-2 whitespace-pre-wrap" data-testid="ot-remarks">
                {v.otRemarks ?? 'No remarks from the technician.'}
              </p>
            </div>
            <PhotoGallery fitmentId={fitment.id} manage={false} allowHistory={false} compact />
          </section>

          <section className="grid min-w-0 content-start gap-4" aria-labelledby="verify-form">
            <h3 id="verify-form" className="font-semibold">
              Verification
            </h3>
            {editable ? (
              <form
                className="grid gap-4"
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  if (canVerify) onVerify();
                  else onSave();
                }}
              >
                {selectField('issueObservedId', optionsWith(lookups.data?.issuesObserved ?? [], v.issueObserved))}
                {selectField('actionTakenId', optionsWith(lookups.data?.actionsTaken ?? [], v.actionTaken))}
                <fieldset className="grid gap-2">
                  <legend className="mb-2 text-sm font-medium">{VERIFICATION_FIELD_LABELS.accessoryIds}</legend>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {accessories.map((a) => (
                      <label key={a.value} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={form.accessoryIds.includes(a.value)}
                          disabled={busy}
                          onCheckedChange={(on) =>
                            set('accessoryIds', on === true ? [...form.accessoryIds, a.value] : form.accessoryIds.filter((x) => x !== a.value))
                          }
                        />
                        {a.label}
                      </label>
                    ))}
                    {accessories.length === 0 && <span className="text-sm text-muted-foreground">No accessories in Masters.</span>}
                  </div>
                </fieldset>
                <div className="grid gap-2">
                  <Label htmlFor="verify-oe-remarks">{VERIFICATION_FIELD_LABELS.oeRemarks}</Label>
                  <Textarea
                    id="verify-oe-remarks"
                    value={form.oeRemarks}
                    rows={3}
                    maxLength={1000}
                    disabled={busy}
                    onChange={(e) => set('oeRemarks', e.target.value)}
                  />
                </div>
                {fitment.canManagePhotos && (
                  <div className="grid gap-2">
                    <span className="text-sm font-medium">Debug image</span>
                    <DebugPhotoUpload fitmentId={fitment.id} tkId={fitment.tkId} />
                  </div>
                )}
                {selectField(
                  'finalIssueId',
                  optionsWith(lookups.data?.finalIssues ?? [], v.finalIssue),
                  <span aria-live="polite">
                    <BillableBadge billable={liveBillable} />
                  </span>,
                )}
                {formError && (
                  <p className="text-sm text-destructive" role="alert" data-testid="verification-error">
                    {formError}
                  </p>
                )}
              </form>
            ) : (
              <ReadOnlyVerification fitment={fitment} />
            )}
          </section>
        </div>

        <SheetFooter className="sticky bottom-0 flex-row flex-wrap justify-end gap-2 border-t bg-background">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {editable ? 'Cancel' : 'Close'}
          </Button>
          {editable && (
            <Button variant={canVerify ? 'outline' : 'default'} onClick={onSave} disabled={busy}>
              {save.isPending && <Loader2 className="animate-spin" />} {canVerify ? 'Save draft' : 'Save changes'}
            </Button>
          )}
          {canVerify && (
            <Button onClick={onVerify} disabled={busy}>
              {verify.isPending && <Loader2 className="animate-spin" />} Verify
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 break-words">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** The verification as text (RO, SA, an OE after OM approval). */
function ReadOnlyVerification({ fitment }: { fitment: FitmentDto }) {
  const v = fitment.verification;
  return (
    <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2" data-testid="verification-readonly">
      <Item label={VERIFICATION_FIELD_LABELS.issueObservedId}>{refText(v.issueObserved)}</Item>
      <Item label={VERIFICATION_FIELD_LABELS.actionTakenId}>{refText(v.actionTaken)}</Item>
      <Item label={VERIFICATION_FIELD_LABELS.accessoryIds}>{v.accessories.length ? v.accessories.map((a) => refText(a)).join(', ') : '—'}</Item>
      <Item label={VERIFICATION_FIELD_LABELS.finalIssueId}>
        <span className="flex flex-wrap items-center gap-2">
          {refText(v.finalIssue)} <BillableBadge billable={v.billable} />
        </span>
      </Item>
      <Item label={VERIFICATION_FIELD_LABELS.oeRemarks}>
        <span className="whitespace-pre-wrap">{v.oeRemarks ?? '—'}</span>
      </Item>
      <Item label="Verified by">
        {fitment.verifiedBy ? `${fitment.verifiedBy.name}${fitment.verifiedAt ? ` · ${formatIst(fitment.verifiedAt)}` : ''}` : 'Not verified yet'}
      </Item>
    </dl>
  );
}
