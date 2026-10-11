import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LookupsResponse, Paginated, TaskListItemDto, UserDto } from '@champ/shared';
import { AuthContext, type AuthContextValue } from '@/lib/auth';
import { lookupsFixture, makeUser, mockApi } from '@/test/fixtures';
import { EMPTY_FILTERS, buildTaskQuery, exportPath } from './taskQuery';
import { TaskTable } from './TaskTable';

const lookups: LookupsResponse = {
  ...lookupsFixture,
  activities: [{ id: 'act-1', name: 'New installation', code: null, assetTypeId: 'at-vehicle' }],
  clients: [
    { id: 'cl-zoom', name: 'Zoomcar', code: 'ZOOM', contactName: 'Priya', contactPhone: '+91 98765 43210', contactEmail: null, sites: [] },
  ],
};

const item: TaskListItemDto = {
  id: 'task-1',
  omId: 'OM-00001',
  oeTaskId: 'OE-00001',
  status: 'OPEN',
  client: { id: 'cl-zoom', name: 'Zoomcar', code: 'ZOOM' },
  site: { id: 'site-1', name: 'Bengaluru depot' },
  city: 'Bengaluru',
  assetType: { id: 'at-vehicle', name: 'Vehicle' },
  activity: { id: 'act-1', name: 'New installation' },
  oe: { id: 'oe-1', name: 'Esha Exec' },
  fitments: { total: 3, assigned: 2, open: 1 },
  fitmentAt: '2026-10-21T05:00:00.000Z',
  createdAt: '2026-10-11T00:00:00.000Z',
};

const page: Paginated<TaskListItemDto> = { items: [item], total: 1, page: 1, pageSize: 20 };

function renderTable(actor: UserDto, view: 'open' | 'assigned' = 'open') {
  const auth: AuthContextValue = {
    status: 'authenticated',
    user: actor,
    login: vi.fn(),
    loginWithGoogle: vi.fn(),
    startSession: vi.fn(),
    logout: vi.fn(),
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter>
          <TaskTable view={view} />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

const listUrls = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.map(([url]) => url as string).filter((u) => u.startsWith('/api/tasks?'));

const params = (url: string) => Object.fromEntries(new URL(url, 'http://x').searchParams);

describe('task query helpers', () => {
  it('builds the list query from the filters, leaving out unset ones', () => {
    expect(buildTaskQuery('open', EMPTY_FILTERS, 1, 20)).toEqual({ view: 'open', sort: 'fitmentAt:asc', page: 1, pageSize: 20 });
    const filters = {
      ...EMPTY_FILTERS,
      q: '  tk-1 ',
      clientId: 'cl-1',
      oeId: 'oe-1',
      technicianId: 'ot-1',
      status: 'ASSIGNED' as const,
      activityId: 'act-1',
      from: '2026-10-01',
      to: '2026-10-31',
      sort: 'createdAt:desc' as const,
    };
    expect(buildTaskQuery('assigned', filters)).toEqual({
      view: 'assigned',
      q: 'tk-1',
      clientId: 'cl-1',
      oeId: 'oe-1',
      technicianId: 'ot-1',
      status: 'ASSIGNED',
      activityId: 'act-1',
      from: '2026-10-01',
      to: '2026-10-31',
      sort: 'createdAt:desc',
    });
  });

  it('builds the export URL with the same filters and no paging', () => {
    expect(exportPath('open', { ...EMPTY_FILTERS, clientId: 'cl-1', q: 'OM-00002' }, 'xlsx')).toBe(
      '/tasks/export?view=open&q=OM-00002&clientId=cl-1&sort=fitmentAt%3Aasc&format=xlsx',
    );
  });
});

describe('TaskTable', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const routes = {
    'GET /api/lookups': lookups,
    'GET /api/tasks': page,
    'GET /api/tasks/options': { oes: [{ id: 'oe-1', name: 'Esha Exec' }], technicians: [] },
  };

  it('lists tasks with ids, customer, counts, IST fitment time and status', async () => {
    mockApi(routes);
    renderTable(makeUser({ role: 'RO' }));
    const row = await within(await screen.findByRole('table')).findByTestId('task-row');
    expect(row).toHaveTextContent('OM-00001');
    expect(row).toHaveTextContent('OE-00001');
    expect(row).toHaveTextContent('Zoomcar');
    expect(row).toHaveTextContent('Bengaluru depot · Bengaluru');
    expect(within(row).getByTestId('task-fitments')).toHaveTextContent('2/3');
    expect(row).toHaveTextContent('21 Oct 2026, 10:30');
    expect(row).toHaveTextContent('Open');
    expect(within(row).getByRole('link', { name: 'OM-00001' })).toHaveAttribute('href', '/tasks/task-1');
    expect(screen.getByTestId('task-card')).toHaveTextContent('OM-00001');
  });

  it('turns the filters into the list query', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi(routes);
    renderTable(makeUser({ role: 'OM' }));
    await waitFor(() => expect(listUrls(fetchMock)).toHaveLength(1));
    expect(params(listUrls(fetchMock)[0]!)).toEqual({ view: 'open', sort: 'fitmentAt:asc', page: '1', pageSize: '20' });

    await user.type(screen.getByLabelText('Search tasks'), 'tk-1');
    await user.click(screen.getByRole('combobox', { name: 'Filter by customer' }));
    await user.click(await screen.findByRole('option', { name: /Zoomcar/ }));
    await user.click(screen.getByRole('combobox', { name: 'Filter by OE' }));
    await user.click(await screen.findByRole('option', { name: 'Esha Exec' }));
    fireEvent.change(screen.getByLabelText('Fitment from'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('Fitment to'), { target: { value: '2026-10-31' } });

    await waitFor(() =>
      expect(params(listUrls(fetchMock).at(-1)!)).toEqual({
        view: 'open',
        q: 'tk-1',
        clientId: 'cl-zoom',
        oeId: 'oe-1',
        from: '2026-10-01',
        to: '2026-10-31',
        sort: 'fitmentAt:asc',
        page: '1',
        pageSize: '20',
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(params(listUrls(fetchMock).at(-1)!)).toEqual({ view: 'open', sort: 'fitmentAt:asc', page: '1', pageSize: '20' }));
  });

  it('Download → Excel requests the export with the current filters and saves the file', async () => {
    const user = userEvent.setup();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const fetchMock = mockApi({
      ...routes,
      'GET /api/tasks/export': () =>
        new Response(new Blob(['xlsx']), { headers: { 'Content-Disposition': 'attachment; filename=champ-tasks-20261011-1030.xlsx' } }),
    });
    renderTable(makeUser({ role: 'OE', id: 'oe-1' }), 'assigned');
    await screen.findAllByTestId('task-row');
    // The OE filter is for SA/OM/RO; an OE has the Assigned view.
    expect(screen.queryByRole('combobox', { name: 'Filter by OE' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Filter by customer' }));
    await user.click(await screen.findByRole('option', { name: /Zoomcar/ }));

    await user.click(screen.getByRole('button', { name: 'Download' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Excel (.xlsx)' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    const exportCall = fetchMock.mock.calls.map(([url]) => url as string).find((u) => u.startsWith('/api/tasks/export'));
    expect(exportCall).toBe('/api/tasks/export?view=assigned&clientId=cl-zoom&sort=fitmentAt%3Aasc&format=xlsx');
    const link = click.mock.contexts[0] as HTMLAnchorElement;
    expect(link.download).toBe('champ-tasks-20261011-1030.xlsx');
  });
});
