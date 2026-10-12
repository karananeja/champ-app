import { useId, useState } from 'react';
import { CalendarDays, CalendarRange, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  HOURS,
  MINUTES,
  dateToDay,
  dayToDate,
  formatDateTimeValue,
  formatDay,
  formatDayRange,
  istToday,
  type DayRange,
  joinDateTime,
  nextRange,
  splitDateTime,
} from '@/lib/dates';
import { cn } from '@/lib/utils';

/**
 * shadcn date pickers built on Calendar (react-day-picker) and Popover (CR-04 / D-088), replacing the native
 * date, time and datetime-local inputs. Values are IST wall-clock strings: `YYYY-MM-DD` for days and
 * `YYYY-MM-DDTHH:mm` for date-times. The popover is modal (focus stays inside, Esc closes and returns focus to
 * the trigger). In a form, pair the trigger with a visible `<Label htmlFor={id}>`; in a filter bar, give it an
 * `aria-label` (the filter pattern, D-089).
 */

interface TriggerA11y {
  id?: string;
  'aria-label'?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

const triggerClass = (empty: boolean, className?: string) =>
  cn('w-full justify-start gap-2 px-3 font-normal', empty && 'text-muted-foreground', className);

/** A small clear (×) button placed over the right end of a trigger, as a sibling (never nested in it). */
function ClearButton({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      className="absolute top-1/2 right-1 size-7 -translate-y-1/2 text-muted-foreground"
      onClick={onClear}
    >
      <X />
    </Button>
  );
}

/** Accessible name of a trigger that has a visible label: the label, then the value or placeholder. */
function useLabelledBy(id: string | undefined, ariaLabel: string | undefined) {
  const valueId = useId();
  // With an aria-label (filters) the name is the aria-label; with an id (forms) it is "<label> <value>".
  const labelledBy = !ariaLabel && id ? `${id}-label ${valueId}` : undefined;
  return { valueId, labelledBy };
}

// --- DatePicker ---

export interface DatePickerProps extends TriggerA11y {
  /** `YYYY-MM-DD` (IST day) or ''. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Shows a clear (×) button when set. */
  clearable?: boolean;
  disabled?: boolean;
  className?: string;
  /** Inclusive bounds, `YYYY-MM-DD`. */
  min?: string;
  max?: string;
}

/** A single day. */
export function DatePicker({
  value,
  onChange,
  placeholder = 'Pick a date',
  clearable,
  disabled,
  className,
  min,
  max,
  id,
  'aria-label': ariaLabel,
  ...aria
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const selected = dayToDate(value) ?? undefined;
  const text = formatDay(value);
  const { valueId, labelledBy } = useLabelledBy(id, ariaLabel);
  const disabledDays = [
    ...(min && dayToDate(min) ? [{ before: dayToDate(min)! }] : []),
    ...(max && dayToDate(max) ? [{ after: dayToDate(max)! }] : []),
  ];

  return (
    <div className={cn('relative min-w-0', className)}>
      <Popover open={open} onOpenChange={setOpen} modal>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            aria-label={ariaLabel ? `${ariaLabel}${text ? `: ${text}` : ''}` : undefined}
            aria-labelledby={labelledBy}
            className={triggerClass(!text, clearable && text ? 'pr-9' : undefined)}
            {...aria}
          >
            <CalendarDays className="text-muted-foreground" />
            <span id={valueId} className="truncate">
              {text || placeholder}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected ?? dayToDate(istToday())!}
            today={dayToDate(istToday())!}
            disabled={disabledDays}
            onSelect={(date) => {
              onChange(date ? dateToDay(date) : '');
              setOpen(false);
            }}
            autoFocus
          />
        </PopoverContent>
      </Popover>
      {clearable && text && !disabled && <ClearButton label={`Clear ${ariaLabel ?? 'date'}`} onClear={() => onChange('')} />}
    </div>
  );
}

// --- DateRangePicker ---

export interface DateRangePickerProps extends TriggerA11y {
  value: DayRange;
  onChange: (value: DayRange) => void;
  placeholder?: string;
  /** Shows a clear (×) button when a range is set (default on: ranges are filters). */
  clearable?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * A from/to range of days in one control (list filters). The first click sets "from", the second "to"; each
 * change is reported at once, so a half-chosen range filters from that day on. Clearing removes the filter.
 */
export function DateRangePicker({
  value,
  onChange,
  placeholder = 'Pick dates',
  clearable = true,
  disabled,
  className,
  id,
  'aria-label': ariaLabel,
  ...aria
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const from = dayToDate(value.from) ?? undefined;
  const to = dayToDate(value.to) ?? undefined;
  const text = formatDayRange(value.from, value.to);
  const { valueId, labelledBy } = useLabelledBy(id, ariaLabel);
  const empty = !value.from && !value.to;

  return (
    <div className={cn('relative min-w-0', className)}>
      <Popover open={open} onOpenChange={setOpen} modal>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            aria-label={ariaLabel ? `${ariaLabel}${text ? `: ${text}` : ''}` : undefined}
            aria-labelledby={labelledBy}
            className={triggerClass(empty, clearable && !empty ? 'pr-9' : undefined)}
            {...aria}
          >
            <CalendarRange className="text-muted-foreground" />
            <span id={valueId} className="truncate">
              {text || placeholder}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            selected={from || to ? { from: from ?? to, to } : undefined}
            defaultMonth={from ?? to ?? dayToDate(istToday())!}
            today={dayToDate(istToday())!}
            onSelect={(_range, clicked) => onChange(nextRange(value, dateToDay(clicked)))}
            autoFocus
          />
          <div className="flex items-center justify-between gap-2 border-t p-2">
            <Button type="button" variant="ghost" size="sm" disabled={empty} onClick={() => onChange({ from: '', to: '' })}>
              Clear
            </Button>
            <Button type="button" size="sm" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {clearable && !empty && !disabled && (
        <ClearButton label={`Clear ${ariaLabel ?? 'dates'}`} onClear={() => onChange({ from: '', to: '' })} />
      )}
    </div>
  );
}

// --- DateTimePicker ---

export interface DateTimePickerProps extends TriggerA11y {
  /** `YYYY-MM-DDTHH:mm` in IST, or ''. */
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Time used when a day is picked before a time (default 10:00). */
  defaultTime?: { hour: string; minute: string };
}

/**
 * A day plus a time chosen with two Selects (hour 00–23, minute in 5-minute steps), in IST. A saved time off
 * the 5-minute grid (e.g. from a bulk upload) is kept and offered as an extra minute option.
 */
export function DateTimePicker({
  value,
  onChange,
  onBlur,
  placeholder = 'Pick date & time',
  disabled,
  className,
  defaultTime = { hour: '10', minute: '00' },
  id,
  'aria-label': ariaLabel,
  ...aria
}: DateTimePickerProps) {
  const [open, setOpen] = useState(false);
  const parts = splitDateTime(value);
  const text = formatDateTimeValue(value);
  const selected = parts ? (dayToDate(parts.day) ?? undefined) : undefined;
  const { valueId, labelledBy } = useLabelledBy(id, ariaLabel);
  const baseId = useId();
  const minutes = parts && !MINUTES.includes(parts.minute) ? [...MINUTES, parts.minute].sort() : MINUTES;
  const hour = parts?.hour ?? defaultTime.hour;
  const minute = parts?.minute ?? defaultTime.minute;
  const day = parts?.day ?? istToday();

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) onBlur?.();
      }}
      modal
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={ariaLabel ? `${ariaLabel}${text ? `: ${text}` : ''}` : undefined}
          aria-labelledby={labelledBy}
          className={triggerClass(!text, className)}
          {...aria}
        >
          <CalendarDays className="text-muted-foreground" />
          <span id={valueId} className="truncate">
            {text || placeholder}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          required
          selected={selected}
          defaultMonth={selected ?? dayToDate(istToday())!}
          today={dayToDate(istToday())!}
          onSelect={(date) => date && onChange(joinDateTime({ day: dateToDay(date), hour, minute }))}
          autoFocus
        />
        <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 border-t p-3">
          <div className="grid gap-1">
            <Label htmlFor={`${baseId}-hour`} className="text-xs text-muted-foreground">
              Hour (IST)
            </Label>
            <Select value={hour} onValueChange={(h) => onChange(joinDateTime({ day, hour: h, minute }))}>
              <SelectTrigger id={`${baseId}-hour`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                {HOURS.map((h) => (
                  <SelectItem key={h} value={h}>
                    {h}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`${baseId}-minute`} className="text-xs text-muted-foreground">
              Minute
            </Label>
            <Select value={minute} onValueChange={(m) => onChange(joinDateTime({ day, hour, minute: m }))}>
              <SelectTrigger id={`${baseId}-minute`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                {minutes.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="button" size="sm" className="h-9" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
