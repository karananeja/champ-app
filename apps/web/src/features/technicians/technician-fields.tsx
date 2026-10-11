import { TECHNICIAN_TYPES, TECHNICIAN_TYPE_LABELS, type TechnicianType } from '@champ/shared';
import { FieldError } from '@/components/field-error';
import { SearchableSelect, type SelectOption } from '@/components/searchable-select';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useLookups } from '../masters/queries';

const ANY = 'ANY';

/**
 * Technician type as a radio group (Payroll / Third party / Contractual). With `anyLabel`, a first choice
 * with that label clears the type (`onChange(null)`), for optional uses such as the task form.
 */
export function TechnicianTypeField({
  id,
  value,
  onChange,
  error,
  anyLabel,
}: {
  id: string;
  value: TechnicianType | undefined | null;
  onChange: (value: TechnicianType | null) => void;
  error?: string;
  anyLabel?: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-2">
      <Label id={`${id}-label`}>Technician type</Label>
      <RadioGroup
        aria-labelledby={`${id}-label`}
        value={value ?? (anyLabel ? ANY : '')}
        onValueChange={(v) => onChange(v === ANY ? null : (v as TechnicianType))}
        className="flex flex-wrap gap-x-4 gap-y-2"
        aria-invalid={!!error}
      >
        {anyLabel && (
          <div className="flex items-center gap-2">
            <RadioGroupItem value={ANY} id={`${id}-any`} />
            <Label htmlFor={`${id}-any`} className="font-normal">
              {anyLabel}
            </Label>
          </div>
        )}
        {TECHNICIAN_TYPES.map((type) => (
          <div key={type} className="flex items-center gap-2">
            <RadioGroupItem value={type} id={`${id}-${type}`} aria-invalid={!!error} />
            <Label htmlFor={`${id}-${type}`} className="font-normal">
              {TECHNICIAN_TYPE_LABELS[type]}
            </Label>
          </div>
        ))}
      </RadioGroup>
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

/**
 * Base location (active Locations from `GET /lookups`) as a searchable select. `current` keeps a
 * technician's existing, now inactive, location selectable when editing.
 */
export function BaseLocationField({
  id,
  value,
  onChange,
  error,
  current,
}: {
  id: string;
  value: string | undefined | null;
  onChange: (value: string) => void;
  error?: string;
  current?: { id: string; city: string; state: string } | null;
}) {
  const lookups = useLookups();
  const options: SelectOption[] = (lookups.data?.locations ?? []).map((l) => ({
    value: l.id,
    label: `${l.city}, ${l.stateName}`,
    hint: l.regionName,
  }));
  if (current && !options.some((o) => o.value === current.id)) {
    options.push({ value: current.id, label: `${current.city}, ${current.state} (inactive)` });
  }
  return (
    <div className="grid grid-cols-1 gap-2">
      <Label htmlFor={id}>Base location</Label>
      <SearchableSelect
        id={id}
        value={value}
        onChange={(v) => onChange(v ?? '')}
        options={options}
        placeholder={lookups.isPending ? 'Loading…' : 'Select a city'}
        searchPlaceholder="Search city or state"
        emptyText="No active location matches."
        aria-invalid={!!error}
      />
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}
