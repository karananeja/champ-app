import { useState, type ComponentProps, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Controller, useForm, useWatch, type FieldErrors, type Resolver } from 'react-hook-form';
import { toast } from 'sonner';
import { ArrowLeft, Loader2 } from 'lucide-react';
import {
  TECHNICIAN_TYPE_LABELS,
  createTaskSchema,
  istInputToIso,
  makeModelIssue,
  toIstInputValue,
  type LookupsResponse,
  type TaskDto,
  type TaskOptionsResponse,
  type TechnicianType,
  type UserDto,
  type VehicleRowInput,
} from '@champ/shared';
import { FieldError } from '@/components/FieldError';
import { SearchableSelect, type SelectOption } from '@/components/SearchableSelect';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { useCurrentUser } from '@/lib/auth';
import { useLookups } from '../masters/queries';
import { TechnicianTypeField } from '../technicians/TechnicianFields';
import { useCreateTask, useTask, useTaskOptions, useUpdateTask, type TaskBody } from './queries';
import { VehicleEntryField } from './VehicleEntryField';

export type VehicleEntry = 'COUNT' | 'CSV';

export interface TaskFormValues {
  clientId: string;
  siteId: string;
  pocName: string;
  pocPhone: string;
  pocEmail: string;
  oeId: string;
  technicianType: TechnicianType | null;
  technicianId: string;
  assetTypeId: string;
  activityId: string;
  deviceTypeId: string;
  makeModelId: string;
  installationTypeId: string;
  /** `datetime-local` values, entered in IST. */
  requestedAt: string;
  fitmentAt: string;
  shiftTypeId: string;
  vehicleEntry: VehicleEntry;
  vehicleCount: string;
  vehicleRows: VehicleRowInput[];
  vehicleFile: string;
  vehicleFileErrors: string[];
  issueReportedId: string;
  gpsAddress: string;
  comments: string;
}

type PocField = 'pocName' | 'pocPhone' | 'pocEmail';

export interface ResolverContext {
  isVehicle: (assetTypeId: string) => boolean;
  editing: boolean;
}

/** The header fields of a create/edit body (times converted from IST to ISO). */
function headerBody(v: TaskFormValues) {
  return {
    clientId: v.clientId,
    siteId: v.siteId,
    pocName: v.pocName,
    pocPhone: v.pocPhone,
    pocEmail: v.pocEmail,
    oeId: v.oeId,
    technicianType: v.technicianType,
    assetTypeId: v.assetTypeId,
    activityId: v.activityId,
    deviceTypeId: v.deviceTypeId,
    makeModelId: v.makeModelId || null,
    installationTypeId: v.installationTypeId,
    requestedAt: istInputToIso(v.requestedAt),
    fitmentAt: istInputToIso(v.fitmentAt),
    shiftTypeId: v.shiftTypeId,
    issueReportedId: v.issueReportedId,
    gpsAddress: v.gpsAddress,
    comments: v.comments,
  };
}

const vehiclesBody = (v: TaskFormValues) =>
  v.vehicleEntry === 'COUNT'
    ? { entry: 'COUNT' as const, count: v.vehicleCount.trim() === '' ? undefined : Number(v.vehicleCount) }
    : { entry: 'CSV' as const, rows: v.vehicleRows };

const createBody = (v: TaskFormValues): TaskBody => ({
  ...headerBody(v),
  vehicles: vehiclesBody(v),
  technicianId: v.technicianId || null,
});

/** A body field (or schema path head) → the form field that shows its error. */
const formField = (field: string, values: TaskFormValues): keyof TaskFormValues =>
  field === 'vehicles'
    ? values.vehicleEntry === 'COUNT'
      ? 'vehicleCount'
      : 'vehicleRows'
    : (field as keyof TaskFormValues);

/**
 * Validates with the shared create schema and make/model rule on the API body built from the form,
 * then maps errors back to form fields. In edit mode the vehicles are not validated (they can't change).
 */
const taskResolver: Resolver<TaskFormValues, ResolverContext> = async (values, context) => {
  const ctx = context!;
  const body = { ...createBody(values), ...(ctx.editing ? { vehicles: { entry: 'COUNT', count: 1 }, technicianId: null } : {}) };
  const errors: Record<string, { type: string; message: string }> = {};
  if (!ctx.editing && values.vehicleEntry === 'CSV' && values.vehicleFileErrors.length > 0) {
    errors.vehicleRows = { type: 'custom', message: 'Fix the problems in the vehicle CSV' };
  }
  for (const issue of createTaskSchema.safeParse(body).error?.issues ?? []) {
    const field = formField(String(issue.path[0] ?? ''), values);
    errors[field] ??= { type: issue.code, message: issue.message };
  }
  // The make/model rule (createTaskSchemaFor) checked here directly, so it shows alongside other errors.
  const makeModel = values.assetTypeId ? makeModelIssue(ctx.isVehicle(values.assetTypeId), values.makeModelId || null) : null;
  if (makeModel) errors.makeModelId ??= { type: 'custom', message: makeModel };
  return Object.keys(errors).length > 0
    ? { values: {}, errors: errors as FieldErrors<TaskFormValues> }
    : { values, errors: {} };
};

function defaultsFor(actor: UserDto, lookups: LookupsResponse, task?: TaskDto): TaskFormValues {
  if (task) {
    return {
      clientId: task.client.id,
      siteId: task.site.id,
      pocName: task.pocName,
      pocPhone: task.pocPhone,
      pocEmail: task.pocEmail ?? '',
      oeId: task.oeId,
      technicianType: task.technicianType,
      technicianId: '',
      assetTypeId: task.assetType.id,
      activityId: task.activity.id,
      deviceTypeId: task.deviceType.id,
      makeModelId: task.makeModel?.id ?? '',
      installationTypeId: task.installationType.id,
      requestedAt: toIstInputValue(task.requestedAt),
      fitmentAt: toIstInputValue(task.fitmentAt),
      shiftTypeId: task.shiftType.id,
      vehicleEntry: task.vehicleEntry,
      vehicleCount: String(task.counts.total),
      vehicleRows: [],
      vehicleFile: '',
      vehicleFileErrors: [],
      issueReportedId: task.issueReported.id,
      gpsAddress: task.gpsAddress ?? '',
      comments: task.comments ?? '',
    };
  }
  return {
    clientId: '',
    siteId: '',
    pocName: '',
    pocPhone: '',
    pocEmail: '',
    oeId: actor.role === 'OE' ? actor.id : '',
    technicianType: null,
    technicianId: '',
    assetTypeId: '',
    activityId: '',
    deviceTypeId: lookups.deviceTypes.find((d) => d.code === 'LAF5')?.id ?? '',
    makeModelId: '',
    installationTypeId: '',
    requestedAt: '',
    fitmentAt: '',
    shiftTypeId: '',
    vehicleEntry: 'COUNT',
    vehicleCount: '1',
    vehicleRows: [],
    vehicleFile: '',
    vehicleFileErrors: [],
    issueReportedId: '',
    gpsAddress: '',
    comments: '',
  };
}

/** Options plus the task's current value when it is no longer offered (shown as "(inactive)"). */
function withCurrent(options: SelectOption[], current?: { id: string; label: string } | null): SelectOption[] {
  if (!current || options.some((o) => o.value === current.id)) return options;
  return [...options, { value: current.id, label: `${current.label} (inactive)` }];
}

const named = (items: { id: string; name: string }[]): SelectOption[] => items.map((i) => ({ value: i.id, label: i.name }));

// --- Page ---

/** `/tasks/new` and `/tasks/:id/edit`. */
export function TaskFormPage() {
  const { id } = useParams();
  const actor = useCurrentUser();
  const lookups = useLookups();
  const options = useTaskOptions();
  const task = useTask(id);

  if (lookups.isError || options.isError || task.isError) {
    return <p className="py-8 text-center text-sm text-destructive">Could not load the task form.</p>;
  }
  if (!lookups.data || !options.data || (id && !task.data)) {
    return (
      <div className="grid grid-cols-1 gap-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (task.data && !task.data.permissions.canEdit) {
    return (
      <div className="grid grid-cols-1 gap-3 py-8 text-center">
        <p className="text-sm text-muted-foreground">
          {task.data.omId} can no longer be edited (work has started, or you don't manage it).
        </p>
        <Link to={`/tasks/${task.data.id}`} className="text-sm underline">
          Back to the task
        </Link>
      </div>
    );
  }
  return <TaskForm key={task.data?.id ?? 'new'} actor={actor} lookups={lookups.data} options={options.data} task={task.data} />;
}

export function TaskForm({
  actor,
  lookups,
  options,
  task,
}: {
  actor: UserDto;
  lookups: LookupsResponse;
  options: TaskOptionsResponse;
  task?: TaskDto;
}) {
  const navigate = useNavigate();
  const editing = !!task;
  const [serverError, setServerError] = useState<string | null>(null);

  const vehicleTypeIds = new Set(lookups.assetTypes.filter((a) => a.code === 'VEHICLE').map((a) => a.id));
  if (task?.assetType.code === 'VEHICLE') vehicleTypeIds.add(task.assetType.id);
  const isVehicle = (assetTypeId: string) => vehicleTypeIds.has(assetTypeId);

  const form = useForm<TaskFormValues, ResolverContext>({
    resolver: taskResolver,
    context: { isVehicle, editing },
    defaultValues: defaultsFor(actor, lookups, task),
  });
  const { control, register, handleSubmit, setValue, getValues, setError, formState } = form;
  /** POC fields the user typed in (RHF's dirty state compares with the defaults, so it can't tell). */
  const [pocEdited, setPocEdited] = useState<Partial<Record<PocField, true>>>({});
  const registerPoc = (name: PocField) =>
    register(name, { onChange: () => setPocEdited((prev) => (prev[name] ? prev : { ...prev, [name]: true })) });
  const { errors, isSubmitting } = formState;
  const [clientId, assetTypeId, technicianType] = useWatch({ control, name: ['clientId', 'assetTypeId', 'technicianType'] });

  /** setValue that marks the field dirty and re-validates after the first submit. */
  const set = <K extends keyof TaskFormValues>(name: K, value: TaskFormValues[K]) =>
    setValue(name, value as never, { shouldDirty: true, shouldValidate: formState.isSubmitted });

  // --- Options (only active values; a task's current inactive value is kept, marked "(inactive)") ---
  const client = lookups.clients.find((c) => c.id === clientId);
  const clientOptions = withCurrent(
    lookups.clients.map((c) => ({ value: c.id, label: c.name, hint: c.code ?? undefined })),
    task && { id: task.client.id, label: task.client.name },
  );
  const siteOptions = withCurrent(
    named(client?.sites ?? []),
    task && clientId === task.client.id ? { id: task.site.id, label: task.site.name } : null,
  );
  const oeOptions = withCurrent(named(options.oes), task && { id: task.oe.id, label: task.oe.name });
  const technicianOptions = options.technicians
    .filter((t) => !technicianType || t.technicianType === technicianType)
    .map((t) => ({
      value: t.id,
      label: t.name,
      hint: [t.technicianType && TECHNICIAN_TYPE_LABELS[t.technicianType], t.baseLocation].filter(Boolean).join(' · '),
    }));
  const assetOptions = withCurrent(named(lookups.assetTypes), task && { id: task.assetType.id, label: task.assetType.name });
  const activityOptions = withCurrent(
    named(lookups.activities.filter((a) => a.assetTypeId === assetTypeId)),
    task && assetTypeId === task.assetType.id ? { id: task.activity.id, label: task.activity.name } : null,
  );
  const deviceOptions = withCurrent(named(lookups.deviceTypes), task && { id: task.deviceType.id, label: task.deviceType.name });
  const makeModelOptions = withCurrent(
    lookups.makeModels.map((m) => ({ value: m.id, label: `${m.make} ${m.model}` })),
    task?.makeModel && { id: task.makeModel.id, label: `${task.makeModel.make} ${task.makeModel.model}` },
  );
  const installOptions = withCurrent(
    named(lookups.installationTypes),
    task && { id: task.installationType.id, label: task.installationType.name },
  );
  const issueOptions = withCurrent(named(lookups.issuesReported), task && { id: task.issueReported.id, label: task.issueReported.name });
  const shiftOptions = withCurrent(named(lookups.shiftTypes), task && { id: task.shiftType.id, label: task.shiftType.name });

  // --- Cascades ---
  const onClientChange = (id: string) => {
    set('clientId', id);
    const next = lookups.clients.find((c) => c.id === id);
    const sites = next?.sites ?? [];
    if (!sites.some((s) => s.id === getValues('siteId'))) set('siteId', sites.length === 1 ? sites[0]!.id : '');
    if (!next) return;
    // POC prefill only fills fields that are empty or that the user hasn't typed in.
    const contact = { pocName: next.contactName, pocPhone: next.contactPhone, pocEmail: next.contactEmail ?? '' };
    for (const [field, value] of Object.entries(contact) as [keyof typeof contact, string][]) {
      if (!getValues(field) || !pocEdited[field]) setValue(field, value);
    }
  };
  const onAssetTypeChange = (id: string) => {
    set('assetTypeId', id);
    const activity = lookups.activities.find((a) => a.id === getValues('activityId'));
    if (activity?.assetTypeId !== id) set('activityId', '');
    if (!isVehicle(id)) set('makeModelId', '');
  };
  const onTechnicianTypeChange = (type: TechnicianType | null) => {
    set('technicianType', type);
    const tech = options.technicians.find((t) => t.id === getValues('technicianId'));
    if (tech && type && tech.technicianType !== type) set('technicianId', '');
  };
  const onTechnicianChange = (id: string) => {
    set('technicianId', id);
    const tech = options.technicians.find((t) => t.id === id);
    if (tech?.technicianType) set('technicianType', tech.technicianType);
  };

  // --- Submit ---
  const create = useCreateTask();
  const update = useUpdateTask(task?.id ?? '');

  const applyServerError = (err: unknown) => {
    if (!(err instanceof ApiError)) return setServerError('Something went wrong. Please try again.');
    const fieldErrors = Object.entries(err.fieldErrors).filter(([, m]) => m?.[0]);
    for (const [field, messages] of fieldErrors) {
      setError(formField(field.split('.')[0]!, getValues()), { message: messages![0] });
    }
    setServerError(fieldErrors.length === 0 ? err.message : 'Please fix the highlighted fields.');
  };

  const submit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      if (task) {
        const saved = await update.mutateAsync(headerBody(values));
        toast.success(`${saved.omId} saved`);
        navigate(`/tasks/${saved.id}`);
      } else {
        const created = await create.mutateAsync(createBody(values));
        toast.success(`Task ${created.omId} created with ${created.counts.total} fitment(s)`);
        navigate(`/tasks/${created.id}`);
      }
    } catch (err) {
      applyServerError(err);
    }
  });

  const isOe = actor.role === 'OE';
  const backTo = task ? `/tasks/${task.id}` : '/tasks';
  const select = (
    name: keyof TaskFormValues,
    id: string,
    label: string,
    opts: SelectOption[],
    extra: Partial<ComponentProps<typeof SearchableSelect>> & { onPick?: (v: string) => void; hint?: ReactNode } = {},
  ) => {
    const { onPick, hint, ...rest } = extra;
    return (
      <div className="grid grid-cols-1 gap-2">
        <Label htmlFor={id}>{label}</Label>
        <Controller
          control={control}
          name={name}
          render={({ field }) => (
            <SearchableSelect
              id={id}
              value={(field.value as string) || null}
              onChange={(v) => (onPick ? onPick(v ?? '') : field.onChange(v ?? ''))}
              options={opts}
              aria-invalid={!!errors[name]}
              {...rest}
            />
          )}
        />
        {hint}
        <FieldError id={`${id}-error`} message={errors[name]?.message as string | undefined} />
      </div>
    );
  };

  return (
    <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="icon-sm" aria-label="Back">
          <Link to={backTo}>
            <ArrowLeft />
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">{task ? `Edit ${task.omId}` : 'Create task'}</h1>
      </div>

      {serverError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}

      <Section title="Customer" description="Who the work is for and where. The fitment city comes from the site.">
        {select('clientId', 'task-client', 'Customer', clientOptions, {
          onPick: onClientChange,
          placeholder: 'Select a customer',
          searchPlaceholder: 'Search customer',
          emptyText: 'No active customer matches.',
        })}
        {select('siteId', 'task-site', 'Site', siteOptions, {
          placeholder: clientId ? 'Select a site' : 'Choose a customer first',
          searchPlaceholder: 'Search site',
          emptyText: 'No active site.',
          disabled: !clientId,
        })}
        <TextField id="task-poc-name" label="POC name" error={errors.pocName?.message} {...registerPoc('pocName')} />
        <TextField id="task-poc-phone" label="POC phone" type="tel" error={errors.pocPhone?.message} {...registerPoc('pocPhone')} />
        <TextField
          id="task-poc-email"
          label="POC email (optional)"
          type="email"
          error={errors.pocEmail?.message}
          {...registerPoc('pocEmail')}
        />
      </Section>

      <Section title="Assignment" description="The technician is optional; fitments can be assigned later from the task page.">
        {select('oeId', 'task-oe', 'Operation executive', oeOptions, {
          disabled: isOe,
          placeholder: 'Select an operation executive',
          searchPlaceholder: 'Search OE',
          hint: isOe ? <p className="text-xs text-muted-foreground">Tasks you create are yours.</p> : undefined,
        })}
        <div className="md:col-span-2">
          <TechnicianTypeField
            id="task-tech-type"
            value={technicianType}
            onChange={onTechnicianTypeChange}
            anyLabel="Any"
            error={errors.technicianType?.message}
          />
        </div>
        {!editing &&
          select('technicianId', 'task-technician', 'Technician (optional)', technicianOptions, {
            onPick: onTechnicianChange,
            clearLabel: 'No technician (assign later)',
            searchPlaceholder: 'Search technician',
            emptyText: 'No active technician of this type.',
          })}
      </Section>

      <Section title="Asset and device">
        {select('assetTypeId', 'task-asset-type', 'Asset type', assetOptions, {
          onPick: onAssetTypeChange,
          placeholder: 'Select an asset type',
          searchPlaceholder: 'Search asset type',
        })}
        {select('activityId', 'task-activity', 'Activity', activityOptions, {
          disabled: !assetTypeId,
          placeholder: assetTypeId ? 'Select an activity' : 'Choose an asset type first',
          searchPlaceholder: 'Search activity',
          emptyText: 'No active activity for this asset type.',
        })}
        {select('deviceTypeId', 'task-device-type', 'Device type', deviceOptions, { searchPlaceholder: 'Search device type' })}
        {isVehicle(assetTypeId) &&
          select('makeModelId', 'task-make-model', 'Vehicle make/model', makeModelOptions, {
            placeholder: 'Select make/model',
            searchPlaceholder: 'Search make or model',
          })}
        {select('installationTypeId', 'task-installation', 'Installation type', installOptions, {
          placeholder: 'Select an installation type',
          searchPlaceholder: 'Search installation type',
        })}
      </Section>

      <Section title="Schedule" description="Dates and times are in IST.">
        <TextField
          id="task-requested-at"
          label="Requested fitment date and time (IST)"
          type="datetime-local"
          error={errors.requestedAt?.message}
          {...register('requestedAt')}
        />
        <TextField
          id="task-fitment-at"
          label="Fitment date and time (IST)"
          type="datetime-local"
          error={errors.fitmentAt?.message}
          {...register('fitmentAt')}
        />
        <div className="grid grid-cols-1 gap-2 md:col-span-2">
          <Label id="task-shift-label">Shift type</Label>
          <Controller
            control={control}
            name="shiftTypeId"
            render={({ field }) => (
              <RadioGroup
                aria-labelledby="task-shift-label"
                value={field.value}
                onValueChange={field.onChange}
                className="flex flex-wrap gap-x-4 gap-y-2"
              >
                {shiftOptions.map((o) => (
                  <div key={o.value} className="flex items-center gap-2">
                    <RadioGroupItem value={o.value} id={`task-shift-${o.value}`} aria-invalid={!!errors.shiftTypeId} />
                    <Label htmlFor={`task-shift-${o.value}`} className="font-normal">
                      {o.label}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            )}
          />
          <FieldError id="task-shift-error" message={errors.shiftTypeId?.message} />
        </div>
      </Section>

      <Section
        title="Vehicles"
        description={
          editing
            ? 'The number of vehicles is fixed once a task exists. Edit vehicle details from the task page.'
            : 'One fitment (technician task) is created per vehicle.'
        }
      >
        {editing ? (
          <p className="text-sm md:col-span-2" data-testid="vehicle-count-fixed">
            {task.counts.total} vehicle(s) · entered {task.vehicleEntry === 'CSV' ? 'from a CSV' : 'as a count'}
          </p>
        ) : (
          <div className="md:col-span-2">
            <VehicleEntryField control={control} register={register} set={set} errors={errors} />
          </div>
        )}
      </Section>

      <Section title="Other">
        {select('issueReportedId', 'task-issue', 'Issue reported by client', issueOptions, {
          placeholder: 'Select the issue',
          searchPlaceholder: 'Search issue',
        })}
        <TextField
          id="task-gps-address"
          label="GPS address (optional)"
          error={errors.gpsAddress?.message}
          {...register('gpsAddress')}
        />
        <div className="grid grid-cols-1 gap-2 md:col-span-2">
          <Label htmlFor="task-comments">Comments (optional)</Label>
          <Textarea id="task-comments" rows={3} aria-invalid={!!errors.comments} {...register('comments')} />
          <FieldError id="task-comments-error" message={errors.comments?.message} />
        </div>
      </Section>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button asChild type="button" variant="outline">
          <Link to={backTo}>Cancel</Link>
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="animate-spin" />}
          {task ? 'Save changes' : 'Create task'}
        </Button>
      </div>
    </form>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">{children}</CardContent>
    </Card>
  );
}

function TextField({
  id,
  label,
  error,
  ...input
}: { id: string; label: string; error?: string } & ComponentProps<typeof Input>) {
  return (
    <div className="grid grid-cols-1 gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} aria-invalid={!!error} {...input} />
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}
