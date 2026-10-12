import { NOTIFICATION_COUNT_EVENT, NOTIFICATION_EVENT } from '@champ/shared';
import { act, screen, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { AppHeader } from '../components/app-header';
import { makeNotification } from '../test/notification-fixtures';
import { fakeSession } from '../test/session-mock';
import { mockFetch, renderWithProviders } from '../test/utils';
import * as apiClient from './api-client';
import { NotificationsProvider, notificationHref, relativeTime } from './notifications';
import { useSession } from './session';

jest.mock('./session');
jest.mock('socket.io-client', () => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const socket = {
    connected: false,
    on: jest.fn((event: string, fn: (...args: unknown[]) => void) => void handlers.set(event, fn)),
    connect: jest.fn(),
    disconnect: jest.fn(),
    removeAllListeners: jest.fn(),
  };
  return { __socket: socket, __handlers: handlers, io: jest.fn(() => socket) };
});

const mocked = jest.requireMock('socket.io-client') as {
  __socket: Record<string, jest.Mock>;
  __handlers: Map<string, (...args: unknown[]) => void>;
  io: jest.Mock;
};
const emit = (event: string, payload: unknown) => act(() => mocked.__handlers.get(event)?.(payload));
const mockedUseSession = jest.mocked(useSession);

let appStateHandler: ((s: AppStateStatus) => void) | null = null;

beforeEach(() => {
  jest.clearAllMocks();
  mocked.__handlers.clear();
  appStateHandler = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, fn) => {
    appStateHandler = fn as (s: AppStateStatus) => void;
    return { remove: jest.fn() } as never;
  });
});

async function renderBell(unreadCount = 2) {
  mockFetch((url) => (url.pathname === '/api/notifications/unread-count' ? { status: 200, body: { unreadCount } } : { status: 404 }));
  return renderWithProviders(
    <NotificationsProvider>
      <AppHeader title="Home" />
    </NotificationsProvider>,
  );
}

describe('NotificationsProvider and the bell', () => {
  it('connects while signed in with the access token over websocket and shows the unread badge', async () => {
    mockedUseSession.mockReturnValue(fakeSession());
    apiClient.setAccessToken('tok-1');
    await renderBell(2);
    expect(await screen.findByLabelText('Notifications, 2 unread')).toBeOnTheScreen();
    expect(screen.getByTestId('bell-badge')).toHaveTextContent('2');
    const [, opts] = mocked.io.mock.calls[0] as [string, { path: string; transports: string[]; auth: (cb: (d: unknown) => void) => void }];
    expect(opts.path).toBe('/socket.io');
    expect(opts.transports).toEqual(['websocket']);
    const cb = jest.fn();
    opts.auth(cb);
    expect(cb).toHaveBeenCalledWith({ token: 'tok-1' });
  });

  it('caps the badge at 9+', async () => {
    mockedUseSession.mockReturnValue(fakeSession());
    await renderBell(12);
    expect(await screen.findByLabelText('Notifications, 12 unread')).toBeOnTheScreen();
    expect(screen.getByTestId('bell-badge')).toHaveTextContent('9+');
  });

  it('a live notification updates the count and shows a toast; a count event clears it', async () => {
    mockedUseSession.mockReturnValue(fakeSession());
    await renderBell(0);
    await waitFor(() => expect(mocked.__handlers.has(NOTIFICATION_EVENT)).toBe(true));
    expect(screen.queryByTestId('bell-badge')).toBeNull();
    await emit(NOTIFICATION_EVENT, { notification: makeNotification({ title: 'TK-00012 reopened by Ravi' }), unreadCount: 3 });
    expect(screen.getByLabelText('Notifications, 3 unread')).toBeOnTheScreen();
    expect(screen.getByText('TK-00012 reopened by Ravi')).toBeOnTheScreen();
    await emit(NOTIFICATION_COUNT_EVENT, { unreadCount: 0 });
    expect(await screen.findByLabelText('Notifications')).toBeOnTheScreen();
    expect(screen.queryByTestId('bell-badge')).toBeNull();
  });

  it('refreshes the token and reconnects on UNAUTHORIZED, once', async () => {
    mockedUseSession.mockReturnValue(fakeSession());
    const refresh = jest.spyOn(apiClient, 'refreshSession').mockResolvedValue({} as never);
    await renderBell(0);
    await waitFor(() => expect(mocked.__handlers.has('connect_error')).toBe(true));
    await emit('connect_error', new Error('UNAUTHORIZED'));
    await waitFor(() => expect(mocked.__socket.connect).toHaveBeenCalledTimes(1));
    await emit('connect_error', new Error('UNAUTHORIZED'));
    expect(refresh).toHaveBeenCalledTimes(1);
    await emit('connect_error', new Error('xhr poll error'));
    expect(refresh).toHaveBeenCalledTimes(1);
    refresh.mockRestore();
  });

  it('reconnects when the app returns to the foreground and disconnects on sign-out', async () => {
    mockedUseSession.mockReturnValue(fakeSession());
    await renderBell(0);
    await waitFor(() => expect(appStateHandler).not.toBeNull());
    await act(() => appStateHandler?.('active'));
    expect(mocked.__socket.connect).toHaveBeenCalledTimes(1);
    // Signing out re-renders the provider with the new session status.
    mockedUseSession.mockReturnValue(fakeSession({ status: 'signed-out', user: null }));
    await emit(NOTIFICATION_COUNT_EVENT, { unreadCount: 1 });
    await waitFor(() => expect(mocked.__socket.disconnect).toHaveBeenCalled());
  });

  it('does not connect while signed out', async () => {
    mockedUseSession.mockReturnValue(fakeSession({ status: 'signed-out', user: null }));
    await renderBell(5);
    expect(mocked.io).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Notifications')).toBeOnTheScreen();
  });
});

describe('notificationHref', () => {
  it('routes by type', () => {
    expect(notificationHref(makeNotification({ type: 'FITMENT_ASSIGNED' }))).toEqual({ pathname: '/fitment/[id]', params: { id: 'f1' } });
    expect(notificationHref(makeNotification({ type: 'FITMENT_APPROVED' }))).toEqual({ pathname: '/fitment/[id]', params: { id: 'f1' } });
    expect(notificationHref(makeNotification({ type: 'FITMENT_REOPENED' }))).toEqual({ pathname: '/fitment/[id]', params: { id: 'f1' } });
    expect(notificationHref(makeNotification({ type: 'FITMENT_SUBMITTED' }))).toEqual({ pathname: '/approve-visit/[id]', params: { id: 'f1' } });
    // The task's OE (approved, reopened by an OM) opens the fitment in Approve visit.
    expect(notificationHref(makeNotification({ type: 'FITMENT_APPROVED', forTechnician: false }))).toEqual({ pathname: '/approve-visit/[id]', params: { id: 'f1' } });
    expect(notificationHref(makeNotification({ type: 'FITMENT_REOPENED', forTechnician: false }))).toEqual({ pathname: '/approve-visit/[id]', params: { id: 'f1' } });
    expect(notificationHref(makeNotification({ type: 'FITMENT_VERIFIED' }))).toBe('/home');
    expect(notificationHref(makeNotification({ type: 'FITMENT_MOVED_TO_FT' }))).toBe('/home');
    expect(notificationHref(makeNotification({ type: 'FITMENT_SUBMITTED', target: { kind: 'FITMENT', taskId: 't1', fitmentId: null } }))).toBe('/home');
    expect(notificationHref(makeNotification({ type: 'TRAVEL_RAISED', target: { kind: 'TRAVEL', travelTaskId: 'tt1' } }))).toBe('/home');
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-10-14T06:00:00.000Z');
  it('is relative for a day, then the IST date and time', () => {
    expect(relativeTime('2026-10-14T05:59:40.000Z', now)).toBe('Just now');
    expect(relativeTime('2026-10-14T05:55:00.000Z', now)).toBe('5 min ago');
    expect(relativeTime('2026-10-14T03:00:00.000Z', now)).toBe('3 h ago');
    expect(relativeTime('2026-10-12T04:30:00.000Z', now)).toMatch(/12 Oct.*10:00 am/i);
  });
});
