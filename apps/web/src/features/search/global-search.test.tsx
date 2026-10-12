import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GlobalSearchResponse, SearchTaskHit, SearchTravelHit, UserDto } from '@champ/shared';
import { AuthContext, type AuthContextValue } from '@/lib/auth';
import { json, makeUser, mockApi } from '@/test/fixtures';
import { GlobalSearch } from './global-search';
import { matchRange } from './search-format';

const taskHit: SearchTaskHit = {
  kind: 'TASK',
  taskId: 'task-1',
  omId: 'OM-00112',
  oeTaskId: 'OE-00007',
  customer: 'Zoomcar',
  site: 'Bengaluru depot',
  status: 'OPEN',
  matches: [],
  fitments: [
    {
      fitmentId: 'fit-1',
      tkId: 'TK-00001',
      status: 'ASSIGNED',
      vehicleRegNo: 'KA 01 AB 1234',
      matches: [{ identifier: 'DEVICE_ID', value: 'LAF5-00123' }],
    },
  ],
};
const travelHit: SearchTravelHit = { kind: 'TRAVEL', travelTaskId: 'tt-1', ttId: 'TT-00003', technician: 'Ravi Kumar', status: 'RAISED', matches: [] };

const response = (overrides: Partial<GlobalSearchResponse> = {}): GlobalSearchResponse => ({
  q: 'laf500123',
  hits: [taskHit, travelHit],
  total: 2,
  truncated: false,
  ...overrides,
});

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <div data-testid="location">{pathname + search}</div>;
}

function renderSearch(route: unknown, user: UserDto = makeUser({ role: 'OM' })) {
  const fetchMock = mockApi({ 'GET /api/search': route });
  const auth: AuthContextValue = { status: 'authenticated', user, login: vi.fn(), loginWithGoogle: vi.fn(), startSession: vi.fn(), logout: vi.fn() };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter>
          <GlobalSearch />
          <Routes>
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return { fetchMock, user: userEvent.setup() };
}

const input = () => screen.getByRole('combobox', { name: 'Search ids' });

describe('GlobalSearch (F14)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('opens with Ctrl K and ⌘K, and from the top-bar button', async () => {
    const { user } = renderSearch(response());
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: 'Search' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'K', metaKey: true });
    expect(await screen.findByRole('dialog', { name: 'Search' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: /Search ids/ }));
    expect(input()).toHaveFocus();
  });

  it('is hidden for roles that cannot view tasks', () => {
    renderSearch(response(), makeUser({ role: 'OT' }));
    expect(screen.queryByRole('button', { name: /Search ids/ })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('asks for 3 characters unless the query is an id', async () => {
    const { user, fetchMock } = renderSearch(response({ hits: [taskHit] }));
    await user.click(screen.getByRole('button', { name: /Search ids/ }));
    await user.type(input(), 'la');
    expect(screen.getByText('Type at least 3 characters')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 300));
    expect(fetchMock).not.toHaveBeenCalled();
    // A bare number is an id (OM/OE/TK).
    await user.clear(input());
    await user.type(input(), '7');
    expect(await screen.findByText('OM-00112')).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/search?q=7');
  });

  it('shows a loading row, then tasks with their fitments and travel tasks, with the match highlighted', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const { user } = renderSearch(async () => {
      await held;
      return response();
    });
    await user.click(screen.getByRole('button', { name: /Search ids/ }));
    await user.type(input(), 'laf5 00');
    expect(await screen.findByText('Searching…')).toBeInTheDocument();
    release();
    const task = await screen.findByTestId('search-task');
    expect(within(task).getByText('OM-00112')).toBeInTheDocument();
    expect(within(task).getByText(/Zoomcar · Bengaluru depot/)).toBeInTheDocument();
    const fitment = within(task).getByTestId('search-fitment');
    expect(fitment).toHaveTextContent('TK-00001');
    expect(fitment).toHaveTextContent('KA 01 AB 1234');
    expect(fitment).toHaveTextContent('Device id: LAF5-00123');
    expect(within(fitment).getByTestId('search-highlight')).toHaveTextContent('LAF5-00');
    expect(screen.getByTestId('search-travel')).toHaveTextContent('TT-00003');
    expect(screen.getByRole('group', { name: 'Travel tasks' })).toBeInTheDocument();
  });

  it('opens the task, the fitment and the travel task', async () => {
    const { user } = renderSearch(response({ truncated: true, total: 30 }));
    const search = async () => {
      await user.click(screen.getByRole('button', { name: /Search ids/ }));
      await user.type(input(), 'laf500123');
      await screen.findByTestId('search-task');
    };
    await search();
    await user.click(screen.getByTestId('search-fitment'));
    expect(screen.getByTestId('location')).toHaveTextContent('/tasks/task-1?fitment=fit-1');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await search();
    await user.click(screen.getByText('OM-00112'));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/tasks\/task-1$/);

    await search();
    // Arrow keys and Enter (cmdk): task, fitment, travel task.
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(screen.getByTestId('location')).toHaveTextContent('/tasks/travel?tt=tt-1');

    await search();
    await user.click(screen.getByText('Show all results'));
    expect(screen.getByTestId('location')).toHaveTextContent('/search?q=laf500123');
  });

  it('shows no matches and errors', async () => {
    const { user } = renderSearch((url: string) =>
      url.includes('boom') ? json({ error: { code: 'INTERNAL_ERROR', message: 'x' } }, 500) : response({ hits: [], total: 0 }),
    );
    await user.click(screen.getByRole('button', { name: /Search ids/ }));
    await user.type(input(), 'zzzz');
    expect(await screen.findByText('No matches for “zzzz”')).toBeInTheDocument();
    await user.clear(input());
    await user.type(input(), 'boom');
    expect(await screen.findByText('Could not search.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('matchRange', () => {
  it('maps a normalized match back to the original characters', () => {
    expect(matchRange('LAF5-00123', 'f500')).toEqual([2, 7]);
    expect(matchRange('KA 01 AB 1234', 'ka01ab')).toEqual([0, 8]);
    expect(matchRange('OM-00112', '112')).toEqual([5, 8]);
    // Not a substring (an id with fewer leading zeros): the whole value.
    expect(matchRange('OM-00112', 'OM-112')).toEqual([0, 8]);
  });
});
