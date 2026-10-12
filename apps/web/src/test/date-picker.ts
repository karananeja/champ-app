import { screen, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

/** Drives the CR-04 date pickers (Calendar + Popover) in component tests. */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthIndex = (label: string) => {
  const [name, year] = label.split(' ');
  return Number(year) * 12 + MONTHS.indexOf(name ?? '');
};

/** In the open calendar, goes to the month of `day` (`YYYY-MM-DD`) and clicks that day. */
export async function chooseDay(user: UserEvent, day: string) {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const target = y * 12 + (m - 1);
  for (let i = 0; i < 600; i++) {
    const current = monthIndex(screen.getByRole('grid').getAttribute('aria-label') ?? '');
    if (current === target) break;
    await user.click(screen.getByRole('button', { name: current < target ? 'Go to the Next Month' : 'Go to the Previous Month' }));
  }
  const name = new RegExp(`${MONTHS[m - 1]} ${d}(st|nd|rd|th), ${y}`);
  await user.click(within(screen.getByRole('grid')).getByRole('button', { name }));
}

/** Picks a Radix Select option by the select's label. */
async function chooseOption(user: UserEvent, label: string, option: string) {
  await user.click(screen.getByRole('combobox', { name: label }));
  await user.click(await screen.findByRole('option', { name: option }));
}

/** Opens the DateTimePicker labelled `label`, picks the day, hour and minute of `value` (`YYYY-MM-DDTHH:mm`, IST). */
export async function pickDateTime(user: UserEvent, label: string, value: string) {
  const [day, time] = value.split('T') as [string, string];
  const [hour, minute] = time.split(':') as [string, string];
  await user.click(screen.getByLabelText(label));
  await chooseDay(user, day);
  await chooseOption(user, 'Hour (IST)', hour);
  await chooseOption(user, 'Minute', minute);
  await user.click(screen.getByRole('button', { name: 'Done' }));
}

/** Opens the DateRangePicker named `name` (its aria-label) and picks `from` then `to`. */
export async function pickDateRange(user: UserEvent, name: string, from: string, to: string) {
  await user.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }));
  await chooseDay(user, from);
  await chooseDay(user, to);
  await user.click(screen.getByRole('button', { name: 'Done' }));
}
