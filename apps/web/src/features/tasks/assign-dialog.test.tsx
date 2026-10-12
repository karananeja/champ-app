import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { TaskOptionsResponse } from '@champ/shared';
import { mockApi } from '@/test/fixtures';
import { AssignDialog } from './assign-dialog';
import { assigneeName, assigneeOptions } from './assignees';

// F10 (D-158): the assign dialog offers the OEs the caller may assign to, labelled "(OE)".
const options: TaskOptionsResponse = {
  oes: [{ id: 'oe-1', name: 'Esha Exec' }],
  technicians: [{ id: 'ot-ravi', name: 'Ravi Kumar', technicianType: 'PAYROLL', baseLocation: 'Bengaluru' }],
  assignableOes: [{ id: 'oe-1', name: 'Esha Exec' }],
};

describe('assigneeOptions', () => {
  it('lists the OTs, then the assignable OEs labelled (OE)', () => {
    expect(assigneeOptions(options)).toEqual([
      { value: 'ot-ravi', label: 'Ravi Kumar', hint: 'Bengaluru' },
      { value: 'oe-1', label: 'Esha Exec (OE)' },
    ]);
    expect(assigneeOptions({ ...options, assignableOes: [] }).map((o) => o.label)).toEqual(['Ravi Kumar']);
    expect(assigneeOptions(undefined)).toEqual([]);
    expect(assigneeName(options, 'oe-1')).toBe('Esha Exec');
    expect(assigneeName(options, 'nope')).toBeUndefined();
  });
});

describe('AssignDialog', () => {
  it('assigns to an OE', async () => {
    mockApi({ 'GET /api/tasks/options': options });
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AssignDialog tkIds={['TK-00001']} onConfirm={onConfirm} onClose={vi.fn()} />
      </QueryClientProvider>,
    );
    await user.click(screen.getByRole('combobox', { name: 'Technician' }));
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getAllByRole('option').map((o) => o.textContent)).toEqual([expect.stringContaining('Ravi Kumar'), 'Esha Exec (OE)']);
    await user.click(within(listbox).getByRole('option', { name: 'Esha Exec (OE)' }));
    await user.click(screen.getByRole('button', { name: 'Assign' }));
    expect(onConfirm).toHaveBeenCalledWith({ id: 'oe-1', name: 'Esha Exec' });
  });
});
