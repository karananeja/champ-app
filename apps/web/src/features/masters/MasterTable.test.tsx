import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LookupItemDto, UserDto } from '@champ/shared';
import { callsTo, json, makeUser, mockApi } from '@/test/fixtures';
import { masterBySlug } from './config';
import { MasterTable } from './MasterTable';

const item = (overrides: Partial<LookupItemDto>): LookupItemDto => ({
  id: 'id',
  kind: 'FINAL_ISSUE',
  name: 'Name',
  code: null,
  isSystem: false,
  active: true,
  billable: false,
  sortOrder: 0,
  createdAt: '2026-10-11T00:00:00.000Z',
  updatedAt: '2026-10-11T00:00:00.000Z',
  ...overrides,
});

const finalIssues = [
  item({ id: 'fi-1', name: 'Wiring issue', billable: true }),
  item({ id: 'fi-2', name: 'Device fault', billable: false }),
  item({ id: 'fi-3', name: 'Retired issue', active: false }),
];

const taskTypes = [
  item({ id: 'tt-ot', kind: 'TASK_TYPE', name: 'OT', code: 'OT', isSystem: true, billable: null }),
  item({ id: 'tt-audit', kind: 'TASK_TYPE', name: 'Audit', billable: null }),
];

const om = makeUser({ id: 'om-1', role: 'OM', name: 'Maya Manager' });

function renderTable(slug: string, actor: UserDto) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MasterTable config={masterBySlug(slug)!} actor={actor} />
    </QueryClientProvider>,
  );
}

/** The desktop table (the card list is rendered too, hidden by CSS below md). */
const table = async () => within(await screen.findByRole('table'));

describe('MasterTable', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the configured columns, billable flags and greyed-out inactive rows', async () => {
    mockApi({ 'GET /api/masters/lookup/final-issue': { items: finalIssues } });
    renderTable('final-issue', om);
    const t = await table();

    expect(t.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Name', 'Billable', 'Status', 'Actions']);
    const rows = t.getAllByTestId('master-row');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText('Billable')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Not billable')).toBeInTheDocument();
    expect(rows[2]).toHaveAttribute('data-active', 'false');
    expect(rows[2]).toHaveClass('opacity-60');
    expect(within(rows[2]!).getByText('Inactive')).toBeInTheDocument();
  });

  // Only SA and OM reach the masters pages (CR-01); the view-only mode remains for an OM without task-type
  // delegation, and for any actor without edit rights.
  it('users without edit rights see the same list without add, edit or toggle controls', async () => {
    mockApi({ 'GET /api/masters/lookup/final-issue': { items: finalIssues } });
    renderTable('final-issue', makeUser({ id: 'oe-1', role: 'OE' }));
    const t = await table();

    expect(t.getAllByTestId('master-row')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /^Add/ })).not.toBeInTheDocument();
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: /^Edit/ })).toHaveLength(0);
    expect(t.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Name', 'Billable', 'Status']);
  });

  it('editors get add, edit and toggle controls', async () => {
    mockApi({ 'GET /api/masters/lookup/final-issue': { items: finalIssues } });
    renderTable('final-issue', om);
    const t = await table();

    expect(screen.getByRole('button', { name: 'Add final issue' })).toBeInTheDocument();
    expect(t.getByRole('switch', { name: 'Deactivate Wiring issue' })).toBeChecked();
    expect(t.getByRole('switch', { name: 'Activate Retired issue' })).not.toBeChecked();
    expect(t.getByRole('button', { name: 'Edit Wiring issue' })).toBeEnabled();
  });

  it('task types are read-only for an OM without delegation, editable with it; built-ins stay locked', async () => {
    mockApi({ 'GET /api/masters/lookup/task-type': { items: taskTypes } });
    renderTable('task-type', om);
    await table();
    expect(screen.queryByRole('button', { name: 'Add task type' })).not.toBeInTheDocument();
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    screen.getAllByText('Operation task').forEach((el) => expect(el).toBeInTheDocument());
  });

  it('a delegated OM can edit custom task types but not the built-ins', async () => {
    mockApi({ 'GET /api/masters/lookup/task-type': { items: taskTypes } });
    renderTable('task-type', makeUser({ id: 'om-2', role: 'OM', canManageTaskTypes: true }));
    const t = await table();
    expect(screen.getByRole('button', { name: 'Add task type' })).toBeInTheDocument();

    const [builtIn, custom] = t.getAllByTestId('master-row');
    expect(within(builtIn!).getByText('Built-in')).toBeInTheDocument();
    expect(within(builtIn!).getByRole('switch')).toBeDisabled();
    expect(within(builtIn!).getByRole('button', { name: 'Edit OT' })).toBeDisabled();
    expect(within(custom!).getByRole('switch')).toBeEnabled();
    expect(within(custom!).getByRole('button', { name: 'Edit Audit' })).toBeEnabled();
  });

  it('adds a final issue with the billable switch', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({
      'GET /api/masters/lookup/final-issue': { items: finalIssues },
      'POST /api/masters/lookup/final-issue': item({ id: 'fi-4', name: 'Loose connector', billable: true }),
    });
    renderTable('final-issue', om);
    await table();

    await user.click(screen.getByRole('button', { name: 'Add final issue' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Name is required')).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText('Name'), 'Loose connector');
    await user.click(within(dialog).getByRole('switch', { name: 'Billable' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(callsTo(fetchMock, 'POST', '/api/masters/lookup/final-issue')).toEqual([
      { name: 'Loose connector', billable: true },
    ]);
  });

  it('shows a duplicate error from the server on the name field', async () => {
    const user = userEvent.setup();
    mockApi({
      'GET /api/masters/lookup/final-issue': { items: finalIssues },
      'POST /api/masters/lookup/final-issue': () =>
        json({ error: { code: 'DUPLICATE', message: '"Wiring issue" already exists in Final issues' } }, 409),
    });
    renderTable('final-issue', om);
    await table();

    await user.click(screen.getByRole('button', { name: 'Add final issue' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'wiring issue');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('"Wiring issue" already exists in Final issues')).toBeInTheDocument();
  });

  it('deactivating asks for confirmation, then PATCHes active=false', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({
      'GET /api/masters/lookup/final-issue': { items: finalIssues },
      'PATCH /api/masters/lookup/final-issue/fi-1': item({ id: 'fi-1', name: 'Wiring issue', active: false }),
    });
    renderTable('final-issue', om);
    const t = await table();

    await user.click(t.getByRole('switch', { name: 'Deactivate Wiring issue' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(within(confirm).getByText('Deactivate Wiring issue?')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'PATCH', '/api/masters/lookup/final-issue/fi-1')).toHaveLength(0);

    await user.click(within(confirm).getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(callsTo(fetchMock, 'PATCH', '/api/masters/lookup/final-issue/fi-1')).toEqual([{ active: false }]);
  });

  it('passes search and filters to the API', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({ 'GET /api/masters/locations': { items: [] } });
    renderTable('locations', om);
    expect(await screen.findByText('No locations found.')).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: 'Filter by state' }));
    await user.click(await screen.findByRole('option', { name: 'Karnataka' }));
    await user.type(screen.getByRole('textbox', { name: 'Search cities' }), 'beng');

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map(([url]) => url as string).filter((u) => u.startsWith('/api/masters'));
      expect(urls.at(-1)).toBe('/api/masters/locations?q=beng&stateId=st-ka');
    });
  });
});
