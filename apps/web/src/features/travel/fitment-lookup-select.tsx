import { useState } from 'react';
import { Check, ChevronsUpDown, Loader2, X } from 'lucide-react';
import { FITMENT_STATUS_LABELS } from '@champ/shared';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDebounced } from '@/hooks/use-debounced';
import { cn } from '@/lib/utils';
import { useFitmentLookup } from './queries';

export interface LinkedFitment {
  id: string;
  tkId: string;
}

interface Props {
  id?: string;
  value: LinkedFitment | null;
  onChange: (value: LinkedFitment | null) => void;
  disabled?: boolean;
  'aria-invalid'?: boolean;
  'aria-labelledby'?: string;
}

/**
 * The related-task combobox of the travel form (F08): type a TK id or number and pick one of up to 10 fitments
 * from `GET /fitments/lookup` (any technician's, e.g. a faulty device being picked up). The search runs on the
 * server, so cmdk's own filtering is off. Cleared with the × button.
 */
export function FitmentLookupSelect({ id, value, onChange, disabled, ...aria }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const q = useDebounced(search, 250);
  const lookup = useFitmentLookup(q);
  const items = lookup.data?.items ?? [];
  const pick = (next: LinkedFitment | null) => {
    onChange(next);
    setOpen(false);
    setSearch('');
  };

  return (
    <div className="relative min-w-0">
      <Popover open={open} onOpenChange={setOpen} modal>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn('w-full justify-between font-normal', !value && 'text-muted-foreground', value && 'pr-9')}
            {...aria}
          >
            <span className="truncate font-mono">{value ? value.tkId : <span className="font-sans">None</span>}</span>
            {!value && <ChevronsUpDown className="opacity-50" />}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Search a TK id, e.g. TK-00012" value={search} onValueChange={setSearch} />
            <CommandList>
              {lookup.isFetching && (
                <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground" role="status">
                  <Loader2 className="size-4 animate-spin" aria-hidden /> Searching…
                </div>
              )}
              {!lookup.isFetching && (
                <CommandEmpty>{q.trim() ? 'No fitment with that TK id.' : 'Type a TK id or number.'}</CommandEmpty>
              )}
              <CommandGroup>
                {items.map((f) => (
                  <CommandItem key={f.id} value={f.id} onSelect={() => pick({ id: f.id, tkId: f.tkId })}>
                    <Check className={cn(f.id === value?.id ? 'opacity-100' : 'opacity-0')} />
                    <span className="min-w-0">
                      <span className="block truncate font-mono">{f.tkId}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {f.omId} · {f.client} · {FITMENT_STATUS_LABELS[f.status]}
                        {f.technician ? ` · ${f.technician}` : ''}
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value && !disabled && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Clear related task"
          className="absolute top-1/2 right-1 size-7 -translate-y-1/2 text-muted-foreground"
          onClick={() => onChange(null)}
        >
          <X />
        </Button>
      )}
    </div>
  );
}
