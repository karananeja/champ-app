import { TECHNICIAN_TYPES, TECHNICIAN_TYPE_LABELS, type TechnicianType } from '@champ/shared';
import { FieldError } from '@/components/FieldError';
import { SearchableSelect, type SelectOption } from '@/components/SearchableSelect';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useLookups } from '../masters/queries';

/** Technician type as a radio group (Payroll / Third party / Contractual). */
export function TechnicianTypeField({
  id,
  value,
  onChange,
  error,
}: {
  id: string;
  value: TechnicianType | undefined | null;
  onChange: (value: TechnicianType) => void;
  error?: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-2">
      <Label id={`${id}-label`}>Technician type</Label>
      <RadioGroup
        aria-labelledby={`${id}-label`}
        value={value ?? ''}
        onValueChange={(v) => onChange(v as TechnicianType)}
        className="flex flex-wrap gap-x-4 gap-y-2"
        aria-invalid={!!error}
      >
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
