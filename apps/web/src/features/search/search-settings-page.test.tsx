import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SEARCH_IDENTIFIER_LABELS, SEARCH_IDENTIFIERS, type Role, type SearchIdentifierSettingDto } from '@champ/shared';
import { App } from '@/app';
import { navGroupsFor } from '@/components/layout/nav';
import { AuthContext, type AuthContextValue } from '@/lib/auth';
import { callsTo, makeUser, mockApi } from '@/test/fixtures';

const settings: SearchIdentifierSettingDto[] = SEARCH_IDENTIFIERS.map((identifier, index) => ({
  identifier,
  label: SEARCH_IDENTIFIER_LABELS[identifier],
  enabled: true,
  sortOrder: index,
}));

function renderAt(role: Role) {
  const fetchMock = mockApi({
    'GET /api/search/identifiers': settings,
    'PUT /api/search/identifiers': (_url: string, init: RequestInit) => {
      const { items } = JSON.parse(init.body as string) as { items: { identifier: string; enabled: boolean }[] };
      return items.map((item, index) => ({ ...item, label: SEARCH_IDENTIFIER_LABELS[item.identifier as keyof typeof SEARCH_IDENTIFIER_LABELS], sortOrder: index }));
    },
  });
  const auth: AuthContextValue = {
    status: 'authenticated',
    user: makeUser({ role, name: 'Test User' }),
    login: vi.fn(),
    loginWithGoogle: vi.fn(),
    startSession: vi.fn(),
    logout: vi.fn(),
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={['/settings/search']}>
          <App />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return { fetchMock, user: userEvent.setup() };
}

const rows = () => screen.getAllByTestId('search-identifier');
const save = () => screen.getByRole('button', { name: 'Save' });

describe('Search identifiers settings (F14)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('toggles, reorders and saves the full list in the new order', async () => {
    const { fetchMock, user } = renderAt('SUPER_ADMIN');
    expect(await screen.findByRole('heading', { name: 'Search identifiers' })).toBeInTheDocument();
    expect(await screen.findAllByTestId('search-identifier')).toHaveLength(10);
    expect(save()).toBeDisabled();

    await user.click(screen.getByRole('switch', { name: 'TK id' }));
    expect(screen.getByRole('switch', { name: 'TK id' })).not.toBeChecked();
    // Device id moves above Travel task id (keyboard accessible buttons).
    screen.getByRole('button', { name: 'Move Device id up' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Move OM id up' })).toBeDisabled();
    expect(within(rows()[3]!).getByText('Device id')).toBeInTheDocument();
    await user.click(save());

    await waitFor(() => expect(callsTo(fetchMock, 'PUT', '/api/search/identifiers')).toHaveLength(1));
    const [body] = callsTo(fetchMock, 'PUT', '/api/search/identifiers') as { items: { identifier: string; enabled: boolean }[] }[];
    expect(body!.items.map((i) => i.identifier)).toEqual([
      'OM_ID', 'OE_TASK_ID', 'TK_ID', 'DEVICE_ID', 'TT_ID',
      'SECONDARY_DEVICE_ID', 'OLD_DEVICE_ID', 'CHASSIS_NO', 'ASSET_NO', 'VEHICLE_REG_NO',
    ]);
    expect(body!.items.find((i) => i.identifier === 'TK_ID')!.enabled).toBe(false);
    expect(body!.items.filter((i) => i.enabled)).toHaveLength(9);
  });

  it('keeps at least one identifier on', async () => {
    const { fetchMock, user } = renderAt('SUPER_ADMIN');
    await screen.findAllByTestId('search-identifier');
    for (const label of Object.values(SEARCH_IDENTIFIER_LABELS)) await user.click(screen.getByRole('switch', { name: label }));
    expect(screen.getByRole('alert')).toHaveTextContent('Keep at least one identifier on');
    expect(save()).toBeDisabled();
    expect(callsTo(fetchMock, 'PUT', '/api/search/identifiers')).toHaveLength(0);
  });

  for (const role of ['OM', 'OE', 'RO'] as const) {
    it(`${role} gets the 403 page and no Settings menu`, async () => {
      renderAt(role);
      expect(await screen.findByTestId('forbidden-page')).toBeInTheDocument();
      expect(navGroupsFor(makeUser({ role })).some((g) => g.label === 'Settings')).toBe(false);
    });
  }

  it('SA has Settings → Search identifiers in the menu', () => {
    const settingsGroup = navGroupsFor(makeUser({ role: 'SUPER_ADMIN' })).find((g) => g.label === 'Settings');
    expect(settingsGroup?.items).toEqual([expect.objectContaining({ to: '/settings/search', label: 'Search identifiers' })]);
  });
});
