import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UserDto } from '@champ/shared';
import { AuthContext, type AuthContextValue } from '@/lib/auth';
import { makeTravelTask, makeUser, mockApi } from '@/test/fixtures';
import { TravelTasksPage } from './travel-tasks-page';

// F08: the Travel tasks page: filters in the URL, rows opening the detail, Raise for SA/OM/OE only.
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

function renderPage(actor: UserDto, path = '/tasks/travel') {
  const tt = makeTravelTask();
  const fetchMock = mockApi({
    'GET /api/travel-tasks': { items: [tt], total: 1, page: 1, pageSize: 20 },
    'GET /api/travel-tasks/tt-1': tt,
    'GET /api/tasks/options': { oes: [{ id: 'oe-1', name: 'Esha Exec' }], technicians: [] },
  });
  const auth: AuthContextValue = { status: 'authenticated', user: actor, login: vi.fn(), loginWithGoogle: vi.fn(), startSession: vi.fn(), logout: vi.fn() };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/tasks/travel" element={<TravelTasksPage />} />
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return fetchMock;
}

const listUrls = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.map(([url]) => url as string).filter((url) => url.startsWith('/api/travel-tasks?') || url === '/api/travel-tasks');

describe('TravelTasksPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads the filters from the URL (dashboard link) and writes changes back to it', async () => {
    const user = userEvent.setup();
    const fetchMock = renderPage(makeUser({ role: 'OM' }), '/tasks/travel?status=RAISED');
    expect(await screen.findAllByText('TT-00001')).not.toHaveLength(0);
    expect(listUrls(fetchMock)[0]).toContain('status=RAISED');
    expect(screen.getByRole('combobox', { name: 'Filter by status' })).toHaveTextContent('Raised');

    await user.click(screen.getByRole('combobox', { name: 'Filter by status' }));
    await user.click(await screen.findByRole('option', { name: 'Verified' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('?status=VERIFIED'));
    await waitFor(() => expect(listUrls(fetchMock).at(-1)).toContain('status=VERIFIED'));

    await user.type(screen.getByRole('textbox', { name: 'Search by TT id' }), 'TT-12');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('q=TT-12'));
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^$/));
  });

  it('opens the detail sheet from a row (?tt=…); an OM gets the OE filter and Raise', async () => {
    const user = userEvent.setup();
    renderPage(makeUser({ role: 'OM' }));
    const row = (await screen.findAllByTestId('travel-row'))[0]!;
    expect(screen.getByRole('combobox', { name: 'Filter by OE' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Raise travel task' })).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'TT-00001' }));
    expect(await screen.findByTestId('travel-detail')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('?tt=tt-1');
  });

  it('OE: no OE filter (their technicians only), but Raise', async () => {
    renderPage(makeUser({ id: 'oe-1', role: 'OE' }));
    await screen.findAllByTestId('travel-row');
    expect(screen.queryByRole('combobox', { name: 'Filter by OE' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Raise travel task' })).toBeInTheDocument();
  });

  it('RO: read-only list (no Raise button), with the Download menu', async () => {
    renderPage(makeUser({ role: 'RO' }));
    await screen.findAllByTestId('travel-row');
    expect(screen.queryByRole('button', { name: 'Raise travel task' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download/ })).toBeInTheDocument();
  });
});
