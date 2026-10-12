import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Label } from '@/components/ui/label';
import { dayToDate, formatDateTimeValue, formatDayRange, istToday, nextRange, splitDateTime, type DayRange } from '@/lib/dates';
import { chooseDay, pickDateRange, pickDateTime } from '@/test/date-picker';
import { DatePicker, DateRangePicker, DateTimePicker } from './date-picker';

// CR-04 / D-088: shadcn Calendar + Popover pickers instead of native date/time inputs.

describe('date helpers', () => {
  it('converts days and date-times without time-zone shifts', () => {
    expect(dayToDate('2026-10-12')?.getDate()).toBe(12);
    expect(dayToDate('2026-02-30')).toBeNull();
    expect(dayToDate('')).toBeNull();
    expect(splitDateTime('2026-10-12T09:05')).toEqual({ day: '2026-10-12', hour: '09', minute: '05' });
    expect(splitDateTime('2026-10-12T24:00')).toBeNull();
    expect(formatDateTimeValue('2026-10-12T10:30')).toBe('12 Oct 2026, 10:30');
    expect(formatDayRange('2026-10-01', '2026-10-31')).toBe('1 Oct 2026 – 31 Oct 2026');
    expect(formatDayRange('2026-10-01', '')).toBe('From 1 Oct 2026');
    expect(formatDayRange('', '2026-10-31')).toBe('Until 31 Oct 2026');
    expect(formatDayRange('', '')).toBe('');
  });

  it('istToday uses the IST calendar day', () => {
    // 20:00 UTC on 11 Oct is 01:30 on 12 Oct in IST.
    expect(istToday(new Date('2026-10-11T20:00:00Z'))).toBe('2026-10-12');
    expect(istToday(new Date('2026-10-11T18:00:00Z'))).toBe('2026-10-11');
  });

  it('nextRange: the first click starts a range, the second ends it (in either order)', () => {
    expect(nextRange({ from: '', to: '' }, '2026-10-05')).toEqual({ from: '2026-10-05', to: '' });
    expect(nextRange({ from: '2026-10-05', to: '' }, '2026-10-09')).toEqual({ from: '2026-10-05', to: '2026-10-09' });
    expect(nextRange({ from: '2026-10-05', to: '' }, '2026-10-01')).toEqual({ from: '2026-10-01', to: '2026-10-05' });
    expect(nextRange({ from: '2026-10-01', to: '2026-10-05' }, '2026-10-20')).toEqual({ from: '2026-10-20', to: '' });
  });
});

function FormHarness({ initial = '', onChange }: { initial?: string; onChange?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <div>
      <Label id="when-label" htmlFor="when">
        Fitment date and time (IST)
      </Label>
      <DateTimePicker
        id="when"
        value={value}
        onChange={(v) => {
          setValue(v);
          onChange?.(v);
        }}
      />
      <output data-testid="value">{value}</output>
    </div>
  );
}

describe('DateTimePicker', () => {
  it('has a visible label, shows a placeholder, and picks an IST day, hour and 5-minute step', async () => {
    const user = userEvent.setup();
    render(<FormHarness />);
    const trigger = screen.getByLabelText('Fitment date and time (IST)');
    expect(trigger).toHaveTextContent('Pick date & time');
    await pickDateTime(user, 'Fitment date and time (IST)', '2027-01-15T18:45');
    expect(screen.getByTestId('value')).toHaveTextContent('2027-01-15T18:45');
    expect(trigger).toHaveTextContent('15 Jan 2027, 18:45');
  });

  it('offers hours 00–23 and minutes in 5-minute steps; keeps an off-grid saved minute', async () => {
    const user = userEvent.setup();
    render(<FormHarness initial="2026-10-21T10:32" />);
    expect(screen.getByLabelText('Fitment date and time (IST)')).toHaveTextContent('21 Oct 2026, 10:32');
    await user.click(screen.getByLabelText('Fitment date and time (IST)'));
    await user.click(screen.getByRole('combobox', { name: 'Hour (IST)' }));
    expect(screen.getAllByRole('option')).toHaveLength(24);
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('combobox', { name: 'Minute' }));
    const minutes = screen.getAllByRole('option').map((o) => o.textContent);
    expect(minutes).toEqual(['00', '05', '10', '15', '20', '25', '30', '32', '35', '40', '45', '50', '55']);
  });

  it('changing the day keeps the time; Esc closes the popover and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<FormHarness initial="2026-10-21T10:30" />);
    const trigger = screen.getByLabelText('Fitment date and time (IST)');
    await user.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await chooseDay(user, '2026-10-22');
    expect(screen.getByTestId('value')).toHaveTextContent('2026-10-22T10:30');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});

function RangeHarness({ onChange }: { onChange: (v: DayRange) => void }) {
  const [value, setValue] = useState<DayRange>({ from: '', to: '' });
  return (
    <DateRangePicker
      aria-label="Filter by fitment date"
      placeholder="Any fitment date"
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange(v);
      }}
    />
  );
}

describe('DateRangePicker', () => {
  it('picks a from/to range in one control and clearing removes the filter', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RangeHarness onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Filter by fitment date' })).toHaveTextContent('Any fitment date');
    expect(screen.queryByRole('button', { name: /^Clear/ })).not.toBeInTheDocument();

    await pickDateRange(user, 'Filter by fitment date', '2026-10-01', '2026-10-31');
    expect(onChange).toHaveBeenLastCalledWith({ from: '2026-10-01', to: '2026-10-31' });
    expect(screen.getByRole('button', { name: /^Filter by fitment date/ })).toHaveTextContent('1 Oct 2026 – 31 Oct 2026');

    await user.click(screen.getByRole('button', { name: 'Clear Filter by fitment date' }));
    expect(onChange).toHaveBeenLastCalledWith({ from: '', to: '' });
    expect(screen.getByRole('button', { name: 'Filter by fitment date' })).toHaveTextContent('Any fitment date');
  });

  it('the Clear button inside the popover also clears', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RangeHarness onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Filter by fitment date' }));
    await chooseDay(user, '2026-10-05');
    expect(onChange).toHaveBeenLastCalledWith({ from: '2026-10-05', to: '' });
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenLastCalledWith({ from: '', to: '' });
  });
});

describe('DatePicker', () => {
  it('picks a single day, closes, and clears when clearable', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [value, setValue] = useState('');
      return <DatePicker aria-label="Due date" clearable value={value} onChange={setValue} />;
    }
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Due date' })).toHaveTextContent('Pick a date');
    await user.click(screen.getByRole('button', { name: 'Due date' }));
    await chooseDay(user, '2026-12-25');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /^Due date/ })).toHaveTextContent('25 Dec 2026');
    await user.click(screen.getByRole('button', { name: 'Clear Due date' }));
    expect(screen.getByRole('button', { name: 'Due date' })).toHaveTextContent('Pick a date');
  });
});
