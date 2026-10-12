import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';
import { Text } from 'react-native';
import { jsonBody, makeUser, mockFetch, secureStore } from '../test/utils';
import { api, setAccessToken } from './api-client';
import { SessionProvider, useSession, type Session } from './session';

let session: Session;
const capture = (s: Session) => {
  session = s;
};
function Probe() {
  const s = useSession();
  useEffect(() => capture(s));
  return <Text testID="status">{s.status}</Text>;
}
const renderSession = async () =>
  await render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } })}>
      <SessionProvider>
        <Probe />
      </SessionProvider>
    </QueryClientProvider>,
  );

const auth = (n: number) => ({ accessToken: `access-${n}`, refreshToken: `refresh-${n}`, user: makeUser() });

beforeEach(() => {
  secureStore.clear();
  setAccessToken(null);
});

describe('session restore', () => {
  it('without a stored token, is signed out', async () => {
    mockFetch(() => ({ status: 500 }));
    await renderSession();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));
  });

  it('refreshes, then loads /me, and stores the rotated refresh token', async () => {
    secureStore.set('champ.refreshToken', 'refresh-0');
    const fetchMock = mockFetch((url, init) => {
      if (url.pathname === '/api/mobile/auth/refresh') {
        expect(jsonBody(init)).toEqual({ refreshToken: 'refresh-0' });
        return { status: 200, body: auth(1) };
      }
      if (url.pathname === '/api/me') {
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer access-1');
        return { status: 200, body: makeUser({ name: 'From Me' }) };
      }
      return { status: 404 };
    });
    await renderSession();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'));
    expect(session.user?.name).toBe('From Me');
    expect(secureStore.get('champ.refreshToken')).toBe('refresh-1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shows offline when the server is unreachable', async () => {
    secureStore.set('champ.refreshToken', 'refresh-0');
    mockFetch(() => 'network');
    await renderSession();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('offline'));
  });

  it('a refused refresh token signs out and clears the store', async () => {
    secureStore.set('champ.refreshToken', 'stale');
    mockFetch(() => ({ status: 401, body: { error: { code: 'REFRESH_INVALID', message: 'Session expired' } } }));
    await renderSession();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));
    expect(secureStore.has('champ.refreshToken')).toBe(false);
  });
});

describe('refresh on 401', () => {
  it('runs a single refresh for concurrent 401s and retries each request once', async () => {
    secureStore.set('champ.refreshToken', 'refresh-0');
    setAccessToken('expired');
    let refreshes = 0;
    mockFetch((url, init) => {
      if (url.pathname === '/api/mobile/auth/refresh') {
        refreshes += 1;
        return { status: 200, body: auth(refreshes) };
      }
      const token = (init.headers as Record<string, string>).Authorization;
      return token === 'Bearer access-1' ? { status: 200, body: { ok: url.pathname } } : { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'x' } } };
    });
    const [a, b] = await Promise.all([api('/a'), api('/b')]);
    expect(a).toEqual({ ok: '/api/a' });
    expect(b).toEqual({ ok: '/api/b' });
    expect(refreshes).toBe(1);
  });

  it('signs out when the refresh after a 401 fails', async () => {
    secureStore.set('champ.refreshToken', 'refresh-0');
    let meCalls = 0;
    mockFetch((url) => {
      if (url.pathname === '/api/mobile/auth/refresh') {
        return meCalls === 0 ? { status: 200, body: auth(1) } : { status: 401, body: { error: { code: 'REFRESH_REUSED', message: 'x' } } };
      }
      if (url.pathname === '/api/me') {
        meCalls += 1;
        return { status: 200, body: makeUser() };
      }
      return { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'Sign in again' } } };
    });
    await renderSession();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'));
    await act(async () => {
      await expect(api('/mobile/home')).rejects.toMatchObject({ status: 401 });
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));
  });

  it('sign out revokes the refresh token and clears the store', async () => {
    secureStore.set('champ.refreshToken', 'refresh-0');
    const calls: string[] = [];
    mockFetch((url, init) => {
      calls.push(url.pathname);
      if (url.pathname === '/api/mobile/auth/refresh') return { status: 200, body: auth(1) };
      if (url.pathname === '/api/me') return { status: 200, body: makeUser() };
      if (url.pathname === '/api/mobile/auth/logout') {
        expect(jsonBody(init)).toEqual({ refreshToken: 'refresh-1' });
        return { status: 204 };
      }
      return { status: 404 };
    });
    await renderSession();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'));
    await act(() => session.signOut());
    expect(calls).toContain('/api/mobile/auth/logout');
    expect(screen.getByTestId('status')).toHaveTextContent('signed-out');
    expect(secureStore.has('champ.refreshToken')).toBe(false);
  });
});
