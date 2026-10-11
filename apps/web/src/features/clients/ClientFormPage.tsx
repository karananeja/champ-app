import { useState, type ComponentProps } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
  type Control,
  type FieldErrors,
  type Resolver,
  type UseFormRegister,
  type UseFormSetValue,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { ArrowLeft, ChevronDown, Loader2, Plus, Trash2 } from 'lucide-react';
import { createClientSchema, type ClientDto } from '@champ/shared';
import { FieldError } from '@/components/FieldError';
import { SearchableSelect, type SelectOption } from '@/components/SearchableSelect';
import { SitePicker } from '@/components/SitePicker';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useLookups } from '../masters/queries';
import { ActiveBadge } from './ActiveBadge';
import {
  useAddSite,
  useClient as useClientQuery,
  useCreateClient,
  useUpdateClient,
  useUpdateSite,
  type ClientFieldsBody,
  type SiteBody,
} from './queries';

export interface SiteValues {
  /** Saved site id; undefined for a site added in this form. */
  siteId?: string;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  locationId: string;
  contactName: string;
  contactPhone: string;
  active: boolean;
}

export interface ClientFormValues {
  name: string;
  code: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  billingEmail: string;
  notes: string;
  sites: SiteValues[];
}

const emptySite = (): SiteValues => ({
  name: '',
  address: '',
  lat: null,
  lng: null,
  locationId: '',
  contactName: '',
  contactPhone: '',
  active: true,
});

function defaultsFor(client?: ClientDto): ClientFormValues {
  if (!client) {
    return {
      name: '',
      code: '',
      contactName: '',
      contactPhone: '',
      contactEmail: '',
      billingEmail: '',
      notes: '',
      sites: [emptySite()],
    };
  }
  return {
    name: client.name,
    code: client.code ?? '',
    contactName: client.contactName,
    contactPhone: client.contactPhone,
    contactEmail: client.contactEmail ?? '',
    billingEmail: client.billingEmail ?? '',
    notes: client.notes ?? '',
    sites: client.sites.map((s) => ({
      siteId: s.id,
      name: s.name,
      address: s.address,
      lat: s.lat,
      lng: s.lng,
      locationId: s.locationId,
      contactName: s.contactName ?? '',
      contactPhone: s.contactPhone ?? '',
      active: s.active,
    })),
  };
}

const clientFieldsBody = (v: ClientFormValues): ClientFieldsBody => ({
  name: v.name,
  code: v.code,
  contactName: v.contactName,
  contactPhone: v.contactPhone,
  contactEmail: v.contactEmail,
  billingEmail: v.billingEmail,
  notes: v.notes,
});

const siteBody = (s: SiteValues): SiteBody => ({
  name: s.name,
  address: s.address,
  lat: s.lat,
  lng: s.lng,
  locationId: s.locationId,
  contactName: s.contactName,
  contactPhone: s.contactPhone,
});

/** The shared create schema validates the raw form values (the API normalises them again). */
const resolver = zodResolver(createClientSchema, undefined, { raw: true }) as unknown as Resolver<ClientFormValues>;

const CLIENT_FIELDS = ['name', 'code', 'contactName', 'contactPhone', 'contactEmail', 'billingEmail', 'notes'] as const;

/** `/clients/new` and `/clients/:id/edit`. */
export function ClientFormPage() {
  const { id } = useParams();
  if (!id) return <ClientForm />;
  return <EditClientLoader id={id} />;
}

function EditClientLoader({ id }: { id: string }) {
  const client = useClientQuery(id);
  if (client.isPending) {
    return (
      <div className="grid grid-cols-1 gap-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (client.isError) return <p className="py-8 text-center text-sm text-destructive">Could not load the client.</p>;
  return <ClientForm key={client.data.id} client={client.data} />;
}

export function ClientForm({ client }: { client?: ClientDto }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const editing = !!client;
  const addOnOpen = editing && params.get('add') === 'site';
  const focusSiteId = params.get('site');

  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const form = useForm<ClientFormValues>({
    resolver,
    defaultValues: (() => {
      const values = defaultsFor(client);
      if (addOnOpen) values.sites.push(emptySite());
      return values;
    })(),
  });
  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, dirtyFields },
  } = form;
  const sites = useFieldArray({ control, name: 'sites', keyName: 'key' });

  // Which site cards are expanded, by field-array key.
  const [open, setOpen] = useState<Set<string>>(() => {
    const keys = new Set<string>();
    sites.fields.forEach((f, i) => {
      const isNew = !f.siteId;
      if ((!editing && i === 0) || (editing && isNew) || (focusSiteId && f.siteId === focusSiteId)) keys.add(f.key);
    });
    return keys;
  });
  const toggle = (key: string, force?: boolean) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (force ?? !next.has(key)) next.add(key);
      else next.delete(key);
      return next;
    });

  const openSitesWithErrors = (siteErrors: FieldErrors<ClientFormValues>['sites']) => {
    if (!Array.isArray(siteErrors)) return;
    siteErrors.forEach((e, i) => {
      if (e && sites.fields[i]) toggle(sites.fields[i]!.key, true);
    });
  };

  const create = useCreateClient();
  const updateClient = useUpdateClient(client?.id ?? '');
  const addSite = useAddSite(client?.id ?? '');
  const updateSite = useUpdateSite(client?.id ?? '');

  /** Maps a server error onto fields (with an optional path prefix); returns a form-level message otherwise. */
  const applyServerError = (err: unknown, prefix = ''): string | null => {
    if (!(err instanceof ApiError)) return 'Something went wrong. Please try again.';
    const fieldErrors = Object.entries(err.fieldErrors).filter(([, m]) => m?.[0]);
    for (const [field, messages] of fieldErrors) {
      setError(`${prefix}${field}` as never, { message: messages![0] });
    }
    return fieldErrors.length === 0 || err.code !== 'DUPLICATE' ? err.message : null;
  };

  const saveNew = async (values: ClientFormValues) => {
    try {
      const created = await create.mutateAsync({ ...clientFieldsBody(values), sites: values.sites.map(siteBody) });
      toast.success(`Client added: ${created.name}`);
      navigate(`/clients/${created.id}`);
    } catch (err) {
      setServerError(applyServerError(err));
      openSitesWithErrors(form.formState.errors.sites);
    }
  };

  const saveExisting = async (values: ClientFormValues) => {
    if (CLIENT_FIELDS.some((f) => dirtyFields[f])) {
      try {
        await updateClient.mutateAsync(clientFieldsBody(values));
      } catch (err) {
        setServerError(applyServerError(err));
        return;
      }
    }
    for (const [i, site] of values.sites.entries()) {
      const prefix = `sites.${i}.`;
      try {
        if (!site.siteId) {
          const created = await addSite.mutateAsync(siteBody(site));
          // A retry after a later failure must not add this site twice.
          setValue(`sites.${i}.siteId`, created.id);
        } else if (Object.values(dirtyFields.sites?.[i] ?? {}).some(Boolean)) {
          await updateSite.mutateAsync({ siteId: site.siteId, body: siteBody(site) });
        }
      } catch (err) {
        const message = applyServerError(err, prefix);
        setServerError(message ?? `Could not save site "${site.name}".`);
        toggle(sites.fields[i]!.key, true);
        return;
      }
    }
    toast.success(`Client saved: ${values.name}`);
    navigate(`/clients/${client!.id}`);
  };

  const submit = handleSubmit(
    async (values) => {
      setServerError(null);
      setSaving(true);
      try {
        await (editing ? saveExisting(values) : saveNew(values));
      } finally {
        setSaving(false);
      }
    },
    (formErrors) => openSitesWithErrors(formErrors.sites),
  );

  const addSiteCard = () => {
    sites.append(emptySite());
  };
  // Expand a site card as soon as it is appended.
  const lastKey = sites.fields.at(-1)?.key;
  const [seenKeys, setSeenKeys] = useState(() => new Set(sites.fields.map((f) => f.key)));
  if (lastKey && !seenKeys.has(lastKey)) {
    setSeenKeys(new Set(sites.fields.map((f) => f.key)));
    toggle(lastKey, true);
  }

  const sitesError =
    (errors.sites as { root?: { message?: string } } | undefined)?.root?.message ?? errors.sites?.message;
  const backTo = client ? `/clients/${client.id}` : '/clients';

  return (
    <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="icon-sm" aria-label="Back">
          <Link to={backTo}>
            <ArrowLeft />
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">{client ? `Edit ${client.name}` : 'Add client'}</h1>
      </div>

      {serverError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Client</CardTitle>
          <CardDescription>Name, short code and the primary contact.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <TextField id="client-name" label="Client name" error={errors.name?.message} {...register('name')} />
          <TextField
            id="client-code"
            label="Short code (optional)"
            placeholder="e.g. ZOOM"
            className="uppercase"
            error={errors.code?.message}
            {...register('code')}
          />
          <TextField
            id="client-contact-name"
            label="Contact name"
            error={errors.contactName?.message}
            {...register('contactName')}
          />
          <TextField
            id="client-contact-phone"
            label="Contact phone"
            type="tel"
            placeholder="+91 98765 43210"
            error={errors.contactPhone?.message}
            {...register('contactPhone')}
          />
          <TextField
            id="client-contact-email"
            label="Contact email (optional)"
            type="email"
            error={errors.contactEmail?.message}
            {...register('contactEmail')}
          />
          <TextField
            id="client-billing-email"
            label="Billing email (optional)"
            type="email"
            error={errors.billingEmail?.message}
            {...register('billingEmail')}
          />
          <div className="grid grid-cols-1 gap-2 md:col-span-2">
            <Label htmlFor="client-notes">Notes (optional)</Label>
            <Textarea id="client-notes" rows={2} aria-invalid={!!errors.notes} {...register('notes')} />
            <FieldError id="client-notes-error" message={errors.notes?.message} />
          </div>
        </CardContent>
      </Card>

      <section className="grid grid-cols-1 gap-3" aria-labelledby="sites-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="sites-heading" className="text-lg font-semibold">
              Sites
            </h2>
            <p className="text-sm text-muted-foreground">Each site has an exact map pin. At least one is required.</p>
          </div>
          <Button type="button" variant="outline" onClick={addSiteCard}>
            <Plus /> Add site
          </Button>
        </div>
        <FieldError id="sites-error" message={sitesError} />
        {sites.fields.map((field, index) => (
          <SiteCard
            key={field.key}
            index={index}
            client={client}
            control={control}
            register={register}
            setValue={setValue}
            getSubmitted={() => form.formState.isSubmitted}
            errors={errors.sites?.[index]}
            open={open.has(field.key)}
            onToggle={() => toggle(field.key)}
            onRemove={field.siteId ? undefined : () => sites.remove(index)}
          />
        ))}
      </section>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button asChild type="button" variant="outline">
          <Link to={backTo}>Cancel</Link>
        </Button>
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          {client ? 'Save changes' : 'Create client'}
        </Button>
      </div>
    </form>
  );
}

function TextField({
  id,
  label,
  error,
  className,
  ...input
}: { id: string; label: string; error?: string } & ComponentProps<typeof Input>) {
  return (
    <div className="grid grid-cols-1 gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} aria-invalid={!!error} className={className} {...input} />
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

function SiteCard({
  index,
  client,
  control,
  register,
  setValue,
  getSubmitted,
  errors,
  open,
  onToggle,
  onRemove,
}: {
  index: number;
  client?: ClientDto;
  control: Control<ClientFormValues>;
  register: UseFormRegister<ClientFormValues>;
  setValue: UseFormSetValue<ClientFormValues>;
  getSubmitted: () => boolean;
  errors?: FieldErrors<SiteValues>;
  open: boolean;
  onToggle: () => void;
  onRemove?: () => void;
}) {
  const lookups = useLookups();
  const site = useWatch({ control, name: `sites.${index}` });
  const saved = client?.sites.find((s) => s.id === site.siteId);
  const prefix = `site-${index}`;

  const options: SelectOption[] = (lookups.data?.locations ?? []).map((l) => ({
    value: l.id,
    label: `${l.city}, ${l.stateName}`,
    hint: l.regionName,
  }));
  if (saved && !options.some((o) => o.value === saved.locationId)) {
    options.push({ value: saved.locationId, label: `${saved.location.city}, ${saved.location.state} (inactive)` });
  }

  const set = <K extends keyof SiteValues>(key: K, value: SiteValues[K]) =>
    setValue(`sites.${index}.${key}` as `sites.${number}.name`, value as never, {
      shouldDirty: true,
      shouldValidate: getSubmitted(),
    });

  const hasErrors = !!errors && Object.keys(errors).length > 0;
  const title = site.name.trim() || `Site ${index + 1}`;

  return (
    <div
      className={cn('rounded-xl border bg-card', hasErrors && 'border-destructive', !site.active && 'opacity-70')}
      data-testid="site-card"
    >
      <div className="flex items-center gap-2 p-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left font-medium"
          aria-expanded={open}
          aria-controls={`${prefix}-body`}
          onClick={onToggle}
        >
          <ChevronDown className={cn('size-4 shrink-0 transition-transform', !open && '-rotate-90')} />
          <span className="truncate">{title}</span>
        </button>
        {!site.active && <ActiveBadge active={false} />}
        {onRemove && (
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${title}`} onClick={onRemove}>
            <Trash2 />
          </Button>
        )}
      </div>
      {open && (
        <div id={`${prefix}-body`} className="grid grid-cols-1 gap-4 border-t p-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <TextField id={`${prefix}-name`} label="Site name" placeholder="e.g. Bengaluru depot" error={errors?.name?.message} {...register(`sites.${index}.name`)} />
          </div>
          <SitePicker
            id={prefix}
            className="md:col-span-2"
            value={{ address: site.address, lat: site.lat, lng: site.lng }}
            onChange={(next) => {
              if (next.address !== site.address) set('address', next.address);
              if (next.lat !== site.lat) set('lat', next.lat);
              if (next.lng !== site.lng) set('lng', next.lng);
            }}
            onSuggestLocation={(locationId) => set('locationId', locationId)}
            addressError={errors?.address?.message}
            pinError={errors?.lat?.message ?? errors?.lng?.message}
          />
          <div className="grid grid-cols-1 gap-2 md:col-span-2">
            <Label htmlFor={`${prefix}-city`}>City</Label>
            <Controller
              control={control}
              name={`sites.${index}.locationId`}
              render={({ field }) => (
                <SearchableSelect
                  id={`${prefix}-city`}
                  value={field.value || null}
                  onChange={(v) => field.onChange(v ?? '')}
                  options={options}
                  placeholder={lookups.isPending ? 'Loading…' : 'Select a city'}
                  searchPlaceholder="Search city or state"
                  emptyText="No active location matches."
                  aria-invalid={!!errors?.locationId}
                />
              )}
            />
            <p className="text-xs text-muted-foreground">Suggested from the pin; you can change it.</p>
            <FieldError id={`${prefix}-city-error`} message={errors?.locationId?.message} />
          </div>
          <TextField
            id={`${prefix}-contact-name`}
            label="Site contact (optional)"
            error={errors?.contactName?.message}
            {...register(`sites.${index}.contactName`)}
          />
          <TextField
            id={`${prefix}-contact-phone`}
            label="Site contact phone (optional)"
            type="tel"
            error={errors?.contactPhone?.message}
            {...register(`sites.${index}.contactPhone`)}
          />
        </div>
      )}
    </div>
  );
}
