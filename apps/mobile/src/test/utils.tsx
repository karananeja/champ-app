import type { UserDto } from '@champ/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SelectedDateProvider } from '../lib/selected-date';

export const router = (jest.requireMock('expo-router') as { __router: Record<string, jest.Mock> }).__router;
export const secureStore = (jest.requireMock('expo-secure-store') as { __store: Map<string, string> }).__store;

export function makeUser(overrides: Partial<UserDto> = {}): UserDto {
  return {
    id: 'u1',
    email: 'tech@champ.test',
    name: 'Ravi Kumar',
    phone: '+91 98450 00001',
    jobTitle: 'Field technician',
    role: 'OT',
    status: 'ACTIVE',
    authProvider: 'PASSWORD',
    managerId: 'm1',
    manager: { id: 'm1', name: 'Asha Rao', phone: '+91 98450 00002' },
    canManageUsers: false,
    canManageTaskTypes: false,
    technicianType: null,
    baseLocationId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    homeLocation: null,
    ...overrides,
  } as UserDto;
}

export type Route = (url: URL, init: RequestInit) => { status: number; body?: unknown } | 'network';

/** Replaces `fetch` with a router over `/api/...` paths; returns the mock to assert calls. */
export function mockFetch(route: Route): jest.Mock {
  const fn = jest.fn(async (input: string, init: RequestInit = {}) => {
    const r = route(new URL(input), init);
    if (r === 'network') throw new TypeError('Network request failed');
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: async () => (r.body === undefined ? '' : JSON.stringify(r.body)),
    } as Response;
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

export const jsonBody = (init: RequestInit): unknown => JSON.parse(String(init.body));

export async function renderWithProviders(ui: ReactElement, { date }: { date?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  return await render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <QueryClientProvider client={client}>
        <SelectedDateProvider initial={date}>{ui}</SelectedDateProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
}
