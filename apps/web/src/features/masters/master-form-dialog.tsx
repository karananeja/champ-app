import { useState } from 'react';
import { Controller, useForm, type Control } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import type { z } from 'zod';
import type { LookupsResponse } from '@champ/shared';
import { FieldError } from '@/components/field-error';
import { SearchableSelect, type SelectOption } from '@/components/searchable-select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ApiError } from '@/lib/api';
import type { FieldDef, MasterConfig, MasterRow } from './config';
import { useLookups, useSaveMaster } from './queries';

type FormValues = Record<string, unknown>;

/** Selects with more options than this become a searchable combobox. */
const SEARCHABLE_THRESHOLD = 10;

interface Props {
  config: MasterConfig;
  /** `null`: closed; `'new'`: add; a row: edit. */
  target: MasterRow | 'new' | null;
  onOpenChange: (open: boolean) => void;
}

/** Add/edit dialog for any master, driven by its config. */
export function MasterFormDialog({ config, target, onOpenChange }: Props) {
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {target !== null && (
          <MasterForm
            key={target === 'new' ? 'new' : target.id}
            config={config}
            row={target === 'new' ? undefined : target}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function MasterForm({ config, row, onClose }: { config: MasterConfig; row?: MasterRow; onClose: () => void }) {
  const lookups = useLookups();
  const save = useSaveMaster(config);
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(config.schema as z.ZodType<FormValues, FormValues>),
    defaultValues: config.defaults(row),
  });

  const submit = handleSubmit((values) => {
    setServerError(null);
    save.mutate(
      { id: row?.id, body: values },
      {
        onSuccess: (saved) => {
          toast.success(`${config.singular} ${row ? 'updated' : 'added'}: ${config.label(saved)}`);
          onClose();
        },
        onError: (err) => {
          if (!(err instanceof ApiError)) return setServerError('Something went wrong. Please try again.');
          const fieldErrors = Object.entries(err.fieldErrors);
          for (const [field, messages] of fieldErrors) {
            if (messages?.[0]) setError(field, { message: messages[0] });
          }
          if (err.code === 'DUPLICATE') setError(config.fields[0]!.name, { message: err.message });
          else if (fieldErrors.length === 0) setServerError(err.message);
        },
      },
    );
  });

  const errorOf = (name: string) => errors[name]?.message as string | undefined;

  return (
    <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-4">
      <DialogHeader>
        <DialogTitle>
          {row ? 'Edit' : 'Add'} {config.singular.toLowerCase()}
        </DialogTitle>
        <DialogDescription>{config.description}</DialogDescription>
      </DialogHeader>

      {serverError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}

      {config.fields.map((field) => {
        const id = `master-${field.name}`;
        const error = errorOf(field.name);
        if (field.type === 'text') {
          return (
            <div key={field.name} className="grid grid-cols-1 gap-2">
              <Label htmlFor={id}>{field.label}</Label>
              <Input id={id} placeholder={field.placeholder} aria-invalid={!!error} {...register(field.name)} />
              <FieldError id={`${id}-error`} message={error} />
            </div>
          );
        }
        if (field.type === 'switch') {
          return (
            <div key={field.name} className="flex items-start justify-between gap-4 rounded-md border p-3">
              <div className="grid gap-1">
                <Label htmlFor={id}>{field.label}</Label>
                <p className="text-sm text-muted-foreground">{field.description}</p>
              </div>
              <Controller
                control={control}
                name={field.name}
                render={({ field: f }) => (
                  <Switch id={id} checked={!!f.value} onCheckedChange={(checked) => f.onChange(checked)} />
                )}
              />
            </div>
          );
        }
        return (
          <SelectField
            key={field.name}
            id={id}
            field={field}
            control={control}
            options={selectOptions(field, lookups.data, row)}
            loading={lookups.isPending}
            error={error}
          />
        );
      })}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" />}
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

type SelectFieldDef = Extract<FieldDef<MasterRow>, { type: 'select' }>;

/** Active options from the lookups, plus the row's current value if it is no longer active. */
function selectOptions(field: SelectFieldDef, lookups: LookupsResponse | undefined, row?: MasterRow): SelectOption[] {
  const list = lookups ? field.options(lookups) : [];
  const current = row && field.current?.(row);
  if (current && !list.some((o) => o.value === current.value)) {
    return [...list, { ...current, label: `${current.label} (inactive)` }];
  }
  return list;
}

function SelectField({
  id,
  field,
  control,
  options,
  loading,
  error,
}: {
  id: string;
  field: SelectFieldDef;
  control: Control<FormValues>;
  options: SelectOption[];
  loading: boolean;
  error?: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-2">
      <Label htmlFor={id}>{field.label}</Label>
      <Controller
        control={control}
        name={field.name}
        render={({ field: f }) =>
          options.length > SEARCHABLE_THRESHOLD ? (
            <SearchableSelect
              id={id}
              value={(f.value as string) || null}
              onChange={(v) => f.onChange(v ?? '')}
              options={options}
              placeholder={field.placeholder}
              searchPlaceholder={`Search ${field.label.toLowerCase()}`}
              aria-invalid={!!error}
            />
          ) : (
            <Select value={(f.value as string) || ''} onValueChange={f.onChange}>
              <SelectTrigger id={id} className="w-full" aria-invalid={!!error}>
                <SelectValue placeholder={loading ? 'Loading…' : field.placeholder} />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )
        }
      />
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}
