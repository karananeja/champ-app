import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { FileText, ImageIcon, Loader2, X } from 'lucide-react';
import {
  TRAVEL_MAX_ATTACHMENTS,
  createTravelSchema,
  isPdf,
  type TravelTaskDto,
} from '@champ/shared';
import { DatePicker } from '@/components/date-picker';
import { FieldError } from '@/components/field-error';
import { SearchableSelect, type SelectOption } from '@/components/searchable-select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { istToday } from '@/lib/dates';
import { useLookups } from '../masters/queries';
import { PhotoDropzone, UploadProgress } from '../tasks/verification/photo-upload';
import { RECEIPT_ACCEPT, validateReceiptFile } from '../tasks/verification/upload-validation';
import { FitmentLookupSelect, type LinkedFitment } from './fitment-lookup-select';
import { useCreateTravel, useTravelOptions, useTravelTransition, useUpdateTravel, useUploadReceipt } from './queries';

/** Raise a new TT, edit one (Raised or Rejected), or edit and resubmit a rejected one. */
export type TravelFormMode = { kind: 'create' } | { kind: 'edit'; tt: TravelTaskDto } | { kind: 'resubmit'; tt: TravelTaskDto };

interface FormValues {
  technicianId: string;
  locationId: string;
  clientId: string;
  purpose: string;
  travelDate: string;
  relatedFitment: LinkedFitment | null;
  /** As typed; blank = not reported. */
  distance: string;
}

type Field = 'technicianId' | 'locationId' | 'clientId' | 'purpose' | 'travelDate' | 'relatedFitmentId' | 'distanceKm' | 'file';
type Errors = Partial<Record<Field, string>>;

const COPY = {
  create: { title: 'Raise travel task', submit: 'Raise travel task', done: 'raised' },
  edit: { title: 'Edit', submit: 'Save changes', done: 'saved' },
  resubmit: { title: 'Resubmit', submit: 'Resubmit', done: 'resubmitted' },
} as const;

const initialValues = (mode: TravelFormMode): FormValues => {
  if (mode.kind === 'create') {
    return { technicianId: '', locationId: '', clientId: '', purpose: '', travelDate: istToday(), relatedFitment: null, distance: '' };
  }
  const { tt } = mode;
  return {
    technicianId: tt.technician.id,
    locationId: tt.location.id,
    clientId: tt.client?.id ?? '',
    purpose: tt.purpose,
    travelDate: tt.travelDate,
    relatedFitment: tt.relatedFitment ? { id: tt.relatedFitment.id, tkId: tt.relatedFitment.tkId } : null,
    distance: tt.distanceKm === null ? '' : String(tt.distanceKm),
  };
};

/** The request body of the form (the API checks it again). */
const bodyOf = (v: FormValues) => ({
  technicianId: v.technicianId,
  locationId: v.locationId,
  clientId: v.clientId || null,
  purpose: v.purpose,
  travelDate: v.travelDate,
  relatedFitmentId: v.relatedFitment?.id ?? null,
  distanceKm: v.distance.trim() === '' ? null : Number(v.distance),
});

const sizeText = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/**
 * The raise / edit dialog (F08; full screen on phones): technician (from `/travel-tasks/options`, preset and
 * hidden when there is only one), location and customer (active masters), purpose, travel date (future days
 * disabled), related task (TK lookup), distance and receipts (images or PDF, checked in the browser). The TT is
 * saved first; the receipts are then uploaded one by one with progress, and the dialog closes. Server messages
 * are shown verbatim.
 */
export function TravelFormDialog({ mode, onClose, onSaved }: { mode: TravelFormMode; onClose: () => void; onSaved?: (tt: TravelTaskDto) => void }) {
  const existing = mode.kind === 'create' ? null : mode.tt;
  const copy = COPY[mode.kind];
  const lookups = useLookups();
  const options = useTravelOptions();
  const create = useCreateTravel();
  const update = useUpdateTravel();
  const transition = useTravelTransition();
  const upload = useUploadReceipt();
  const [values, setValues] = useState<FormValues>(() => initialValues(mode));
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<{ name: string; value: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => setValues((prev) => ({ ...prev, [key]: value }));

  // Technicians: the options, plus the TT's own technician when editing (they may be out of the list now).
  const technicians: SelectOption[] = (options.data?.technicians ?? []).map((t) => ({ value: t.id, label: t.name, hint: t.baseLocation ?? undefined }));
  if (existing && !technicians.some((t) => t.value === existing.technician.id)) {
    technicians.push({ value: existing.technician.id, label: existing.technician.name });
  }
  const onlyTechnician = mode.kind === 'create' && options.isSuccess && technicians.length === 1 ? technicians[0]! : null;
  // With a single choice the technician is preset (and the field hidden).
  const effective: FormValues = onlyTechnician ? { ...values, technicianId: onlyTechnician.value } : values;

  const locations: SelectOption[] = (lookups.data?.locations ?? []).map((l) => ({ value: l.id, label: l.city, hint: l.stateName }));
  if (existing && !locations.some((l) => l.value === existing.location.id)) {
    locations.push({ value: existing.location.id, label: `${existing.location.city} (inactive)` });
  }
  const customers: SelectOption[] = (lookups.data?.clients ?? []).map((c) => ({ value: c.id, label: c.name, hint: c.code ?? undefined }));
  if (existing?.client && !customers.some((c) => c.value === existing.client!.id)) {
    customers.push({ value: existing.client.id, label: `${existing.client.name} (inactive)` });
  }

  /** Picking a technician fills an empty location with their base city. */
  const chooseTechnician = (id: string | null) => {
    set('technicianId', id ?? '');
    const base = options.data?.technicians.find((t) => t.id === id)?.baseLocation;
    const location = base ? lookups.data?.locations.find((l) => l.city === base) : undefined;
    if (location && !values.locationId) set('locationId', location.id);
  };

  const room = TRAVEL_MAX_ATTACHMENTS - (existing?.attachmentCount ?? 0);
  // Several files can arrive from one pick, before the state updates: count them here.
  const fileCount = useRef(0);
  const addFile = (file: File) => {
    if (fileCount.current >= room) {
      setErrors((prev) => ({ ...prev, file: `At most ${TRAVEL_MAX_ATTACHMENTS} receipts per travel task` }));
      return;
    }
    fileCount.current += 1;
    setErrors((prev) => ({ ...prev, file: undefined }));
    setFiles((prev) => [...prev, file]);
  };

  const save = (body: ReturnType<typeof bodyOf>): Promise<TravelTaskDto> => {
    if (mode.kind === 'create') return create.mutateAsync(body);
    if (mode.kind === 'edit') return update.mutateAsync({ id: mode.tt.id, body });
    return transition.mutateAsync({ id: mode.tt.id, body: { action: 'RESUBMIT', changes: body } });
  };

  const submit = async () => {
    setFormError(null);
    const body = bodyOf(effective);
    const parsed = createTravelSchema.safeParse(body);
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as Field;
        next[field] ??= field === 'distanceKm' && Number.isNaN(body.distanceKm) ? 'Enter the distance as a number of km' : issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setBusy(true);
    let tt: TravelTaskDto;
    try {
      tt = await save(body);
    } catch (err) {
      setBusy(false);
      if (!(err instanceof ApiError)) {
        setFormError('Something went wrong. Please try again.');
        return;
      }
      const fieldErrors = Object.entries(err.fieldErrors).filter(([, m]) => m?.[0]);
      if (fieldErrors.length) setErrors(Object.fromEntries(fieldErrors.map(([f, m]) => [f, m![0]])) as Errors);
      else setFormError(err.message);
      return;
    }
    // Receipts go up after the TT is saved, one at a time with progress; a refused file doesn't undo the TT.
    const failed: string[] = [];
    for (const file of files) {
      setProgress({ name: file.name, value: 0 });
      try {
        await upload.mutateAsync({ id: tt.id, file, onProgress: (value) => setProgress({ name: file.name, value }) });
      } catch (err) {
        failed.push(`${file.name}: ${err instanceof ApiError ? err.message : 'could not be uploaded'}`);
      }
    }
    setProgress(null);
    setBusy(false);
    toast.success(`${tt.ttId} ${copy.done}`);
    for (const message of failed) toast.error(message);
    onSaved?.(tt);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg max-sm:inset-0 max-sm:top-0 max-sm:left-0 max-sm:h-svh max-sm:max-h-none max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none"
        data-testid="travel-form"
      >
        <form
          noValidate
          className="grid grid-cols-1 gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{existing ? `${copy.title} ${existing.ttId}` : copy.title}</DialogTitle>
            <DialogDescription>
              {mode.kind === 'resubmit'
                ? 'Fix what was rejected, then resubmit it for verification. The rejection stays in the history.'
                : 'A trip outside a planned fitment, for verification and reimbursement.'}
            </DialogDescription>
          </DialogHeader>

          {formError && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          {onlyTechnician ? (
            <div className="grid gap-1 text-sm" data-testid="technician-preset">
              <span className="text-muted-foreground">Technician</span>
              <span className="font-medium">{onlyTechnician.label}</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2">
              <Label htmlFor="tt-technician">Technician</Label>
              <SearchableSelect
                id="tt-technician"
                value={values.technicianId || null}
                onChange={chooseTechnician}
                options={technicians}
                placeholder={options.isPending ? 'Loading…' : 'Pick a technician'}
                searchPlaceholder="Search technician"
                aria-invalid={!!errors.technicianId}
              />
              <FieldError id="tt-technician-error" message={errors.technicianId} />
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid grid-cols-1 content-start gap-2">
              <Label htmlFor="tt-location">Location</Label>
              <SearchableSelect
                id="tt-location"
                value={values.locationId || null}
                onChange={(v) => set('locationId', v ?? '')}
                options={locations}
                placeholder="Choose a city"
                searchPlaceholder="Search city"
                aria-invalid={!!errors.locationId}
              />
              <FieldError id="tt-location-error" message={errors.locationId} />
            </div>
            <div className="grid grid-cols-1 content-start gap-2">
              <Label htmlFor="tt-customer">
                Customer <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <SearchableSelect
                id="tt-customer"
                value={values.clientId || null}
                onChange={(v) => set('clientId', v ?? '')}
                options={customers}
                placeholder="No customer"
                clearLabel="No customer"
                searchPlaceholder="Search customer"
                aria-invalid={!!errors.clientId}
              />
              <FieldError id="tt-customer-error" message={errors.clientId} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2">
            <Label htmlFor="tt-purpose">Purpose of travel</Label>
            <Textarea
              id="tt-purpose"
              rows={3}
              maxLength={1000}
              value={values.purpose}
              placeholder="e.g. Picked up a faulty device from the customer's depot"
              aria-invalid={!!errors.purpose}
              aria-describedby={errors.purpose ? 'tt-purpose-error' : undefined}
              onChange={(e) => set('purpose', e.target.value)}
            />
            <FieldError id="tt-purpose-error" message={errors.purpose} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid grid-cols-1 content-start gap-2">
              <Label id="tt-date-label" htmlFor="tt-date">
                Travel date
              </Label>
              <DatePicker
                id="tt-date"
                value={values.travelDate}
                onChange={(v) => set('travelDate', v)}
                max={istToday()}
                placeholder="Pick the travel date"
                aria-invalid={!!errors.travelDate}
              />
              <FieldError id="tt-date-error" message={errors.travelDate} />
            </div>
            <div className="grid grid-cols-1 content-start gap-2">
              <Label htmlFor="tt-distance">
                Distance (km) <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="tt-distance"
                type="number"
                inputMode="decimal"
                min={0}
                max={5000}
                step={0.1}
                value={values.distance}
                aria-invalid={!!errors.distanceKm}
                aria-describedby={errors.distanceKm ? 'tt-distance-error' : undefined}
                onChange={(e) => set('distance', e.target.value)}
              />
              <FieldError id="tt-distance-error" message={errors.distanceKm} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2">
            <Label id="tt-related-label" htmlFor="tt-related">
              Related task <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <FitmentLookupSelect
              id="tt-related"
              value={values.relatedFitment}
              onChange={(v) => set('relatedFitment', v)}
              aria-invalid={!!errors.relatedFitmentId}
            />
            <FieldError id="tt-related-error" message={errors.relatedFitmentId} />
          </div>

          <div className="grid grid-cols-1 gap-2">
            <span className="text-sm font-medium">
              Receipts <span className="font-normal text-muted-foreground">(optional)</span>
            </span>
            {room > 0 ? (
              <PhotoDropzone
                label="Add receipts"
                hint={`Tickets or bills: images or PDF, up to 10 MB each, at most ${TRAVEL_MAX_ATTACHMENTS} per travel task.`}
                accept={RECEIPT_ACCEPT}
                validate={validateReceiptFile}
                multiple
                disabled={busy}
                onFile={addFile}
                onInvalid={(message) => setErrors((prev) => ({ ...prev, file: message }))}
              />
            ) : (
              <p className="text-sm text-muted-foreground">This travel task already has {TRAVEL_MAX_ATTACHMENTS} receipts.</p>
            )}
            {files.length > 0 && (
              <ul className="grid gap-1" aria-label="Receipts to upload">
                {files.map((file, i) => (
                  <li key={`${file.name}-${i}`} className="flex min-w-0 items-center gap-2 rounded-md border px-2 py-1 text-sm" data-testid="pending-receipt">
                    {isPdf(file.type) ? <FileText className="size-4 shrink-0" aria-hidden /> : <ImageIcon className="size-4 shrink-0" aria-hidden />}
                    <span className="min-w-0 flex-1 truncate">{file.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{sizeText(file.size)}</span>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      aria-label={`Remove ${file.name}`}
                      disabled={busy}
                      onClick={() => {
                        fileCount.current -= 1;
                        setFiles((prev) => prev.filter((_, j) => j !== i));
                      }}
                    >
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {progress && <UploadProgress value={progress.value} label={`Uploading ${progress.name}`} />}
            {errors.file && (
              <p className="text-sm text-destructive" role="alert" data-testid="receipt-error">
                {errors.file}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />} {copy.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
