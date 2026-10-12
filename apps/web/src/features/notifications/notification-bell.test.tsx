import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOTIFICATION_COUNT_EVENT, NOTIFICATION_EVENT, NOTIFICATION_SOCKET_PATH, type NotificationDto, type UserDto } from '@champ/shared';
import { Toaster } from '@/components/ui/sonner';
import { setAccessToken } from '@/lib/api';
import { AuthContext, type AuthContextValue } from '@/lib/auth';
import { callsTo, makeFitment, makeTask, makeUser, mockApi } from '@/test/fixtures';
import { TaskDetailPage } from '../tasks/task-detail-page';
import { NotificationBell } from './notification-bell';
import { badgeText, notificationTime } from './notification-format';

// A fake Socket.IO client: records handlers so tests can play server events.
const socket = vi.hoisted(() => {
  const handlers = new Map<string, (payload: unknown) => void>();
  return {
    handlers,
    on: vi.fn((event: string, handler: (payload: unknown) => void) => handlers.set(event, handler)),
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
});
const io = vi.hoisted(() => vi.fn((..._args: unknown[]) => socket));
vi.mock('socket.io-client', () => ({ io }));

const serverEmit = (event: string, payload: unknown) => act(() => socket.handlers.get(event)!(payload));

function makeNotification(overrides: Partial<NotificationDto> = {}): NotificationDto {
  return {
    id: 'n-1',
    type: 'FITMENT_SUBMITTED',
    title: 'TK-00001 submitted by Ravi · ready to verify',
    body: 'Zoomcar · Bengaluru depot',
    target: { kind: 'FITMENT', taskId: 'task-1', fitmentId: 'fit-1' },
    count: 1,
    actor: { id: 'ot-1', name: 'Ravi Kumar' },
    read: false,
    createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    ...overrides,
  };
}

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <div data-testid="location">{pathname + search}</div>;
}

const oe = makeUser({ id: 'oe-1', role: 'OE', name: 'Esha Exec' });

function renderBell(routes: Record<string, unknown>, { user = oe as UserDto | null, path = '/' } = {}) {
  const fetchMock = mockApi({ 'GET /api/config': { googleClientId: null, devSimulator: false }, ...routes });
  const auth = (u: UserDto | null): AuthContextValue => ({
    status: u ? 'authenticated' : 'anonymous',
    user: u,
    login: vi.fn(),
    loginWithGoogle: vi.fn(),
    startSession: vi.fn(),
    logout: vi.fn(),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (u: UserDto | null) => (
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth(u)}>
        <MemoryRouter initialEntries={[path]}>
          <NotificationBell />
          <Routes>
            <Route path="*" element={<LocationProbe />} />
          </Routes>
          <Toaster />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>
  );
  const view = render(tree(user));
  return { fetchMock, rerender: (u: UserDto | null) => view.rerender(tree(u)) };
}

const list = (items: NotificationDto[], extra: { unreadCount?: number; nextCursor?: string | null } = {}) => ({
  items,
  unreadCount: extra.unreadCount ?? items.filter((n) => !n.read).length,
  nextCursor: extra.nextCursor ?? null,
});

beforeEach(() => {
  socket.handlers.clear();
  setAccessToken('token-1');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  setAccessToken(null);
});

describe('notification format', () => {
  it('shows relative times, then the IST date and time; caps the badge at 9+', () => {
    const now = Date.parse('2026-10-12T10:00:00.000Z');
    expect(notificationTime('2026-10-12T09:59:30.000Z', now)).toBe('Just now');
    expect(notificationTime('2026-10-12T09:55:00.000Z', now)).toBe('5 min ago');
    expect(notificationTime('2026-10-12T07:00:00.000Z', now)).toBe('3 h ago');
    expect(notificationTime('2026-10-10T04:30:00.000Z', now)).toBe('10 Oct 2026, 10:00');
    expect(badgeText(3)).toBe('3');
    expect(badgeText(12)).toBe('9+');
  });
});

describe('notification bell (F13)', () => {
  it('shows the unread count and lists the notifications with body, time and an unread dot', async () => {
    const user = userEvent.setup();
    renderBell({
      'GET /api/notifications/unread-count': { unreadCount: 12 },
      'GET /api/notifications': list([makeNotification(), makeNotification({ id: 'n-2', title: 'TK-00002 approved', body: null, read: true })]),
    });
    const bell = await screen.findByRole('button', { name: 'Notifications, 12 unread' });
    expect(within(bell).getByTestId('notification-badge')).toHaveTextContent('9+');
    await user.click(bell);
    const items = await screen.findAllByTestId('notification-item');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('TK-00001 submitted by Ravi · ready to verify');
    expect(items[0]).toHaveTextContent('Zoomcar · Bengaluru depot');
    expect(items[0]).toHaveTextContent('5 min ago');
    expect(within(items[0]!).getByLabelText('Unread')).toBeInTheDocument();
    expect(within(items[1]!).queryByLabelText('Unread')).not.toBeInTheDocument();
  });

  it('shows the empty state and no badge when there is nothing', async () => {
    const user = userEvent.setup();
    renderBell({ 'GET /api/notifications/unread-count': { unreadCount: 0 }, 'GET /api/notifications': list([]) });
    const bell = await screen.findByRole('button', { name: 'Notifications' });
    expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument();
    await user.click(bell);
    expect(await screen.findByText("You're all caught up")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mark all as read/ })).toBeDisabled();
  });

  it('a tap marks the notification read and opens the fitment on its task', async () => {
    const user = userEvent.setup();
    let unreadCount = 1;
    const { fetchMock } = renderBell({
      'GET /api/notifications/unread-count': () => ({ unreadCount }),
      'GET /api/notifications': list([makeNotification()]),
      'POST /api/notifications/n-1/read': () => {
        unreadCount = 0;
        return new Response(null, { status: 204 });
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));
    await user.click(await screen.findByTestId('notification-item'));
    expect(screen.getByTestId('location')).toHaveTextContent('/tasks/task-1?fitment=fit-1');
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/api/notifications/n-1/read')).toHaveLength(1));
    expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument();
  });

  it('a travel notification opens the travel task sheet; a read one is not marked again', async () => {
    const user = userEvent.setup();
    const { fetchMock } = renderBell({
      'GET /api/notifications/unread-count': { unreadCount: 0 },
      'GET /api/notifications': list([makeNotification({ type: 'TRAVEL_RAISED', read: true, target: { kind: 'TRAVEL', travelTaskId: 'tt-1' } })]),
    });
    await user.click(await screen.findByRole('button', { name: 'Notifications' }));
    await user.click(await screen.findByTestId('notification-item'));
    expect(screen.getByTestId('location')).toHaveTextContent('/tasks/travel?tt=tt-1');
    expect(callsTo(fetchMock, 'POST', '/api/notifications/n-1/read')).toHaveLength(0);
  });

  it('Mark all as read clears the count and the unread dots', async () => {
    const user = userEvent.setup();
    const { fetchMock } = renderBell({
      'GET /api/notifications/unread-count': { unreadCount: 2 },
      'GET /api/notifications': list([makeNotification(), makeNotification({ id: 'n-2' })]),
      'POST /api/notifications/read-all': new Response(null, { status: 204 }),
    });
    await user.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
    await screen.findAllByTestId('notification-item');
    await user.click(screen.getByRole('button', { name: /Mark all as read/ }));
    await waitFor(() => expect(screen.queryByLabelText('Unread')).not.toBeInTheDocument());
    expect(callsTo(fetchMock, 'POST', '/api/notifications/read-all')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('Load more fetches the next page with the cursor', async () => {
    const user = userEvent.setup();
    const { fetchMock } = renderBell({
      'GET /api/notifications/unread-count': { unreadCount: 0 },
      'GET /api/notifications': (url: string) =>
        url.includes('cursor=c-2')
          ? list([makeNotification({ id: 'n-2', title: 'Older one', read: true })])
          : list([makeNotification({ read: true })], { nextCursor: 'c-2' }),
    });
    await user.click(await screen.findByRole('button', { name: 'Notifications' }));
    await user.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Older one')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('cursor=c-2'))).toBe(true);
  });
});

describe('notification socket (F13)', () => {
  it('connects with the access token; a live notification updates the count and list and toasts with View', async () => {
    const user = userEvent.setup();
    renderBell({ 'GET /api/notifications/unread-count': { unreadCount: 0 }, 'GET /api/notifications': list([]) });
    await screen.findByRole('button', { name: 'Notifications' });
    expect(io).toHaveBeenCalledWith(expect.objectContaining({ path: NOTIFICATION_SOCKET_PATH }));
    const { auth } = io.mock.calls[0]![0] as { auth: (cb: (data: object) => void) => void };
    const cb = vi.fn();
    auth(cb);
    expect(cb).toHaveBeenCalledWith({ token: 'token-1' });

    await user.click(screen.getByRole('button', { name: 'Notifications' }));
    await screen.findByText("You're all caught up");
    serverEmit(NOTIFICATION_EVENT, { notification: makeNotification({ id: 'n-9', title: 'TK-00009 assigned to you' }), unreadCount: 4 });
    expect(await screen.findByRole('button', { name: 'Notifications, 4 unread' })).toBeInTheDocument();
    expect(screen.getAllByText('TK-00009 assigned to you').length).toBeGreaterThanOrEqual(2); // list + toast
    await user.keyboard('{Escape}');
    await user.click(await screen.findByRole('button', { name: 'View' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/tasks/task-1?fitment=fit-1');
  });

  it('a count event (read in another tab) sets the count', async () => {
    renderBell({ 'GET /api/notifications/unread-count': { unreadCount: 3 } });
    await screen.findByRole('button', { name: 'Notifications, 3 unread' });
    serverEmit(NOTIFICATION_COUNT_EVENT, { unreadCount: 0 });
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('on UNAUTHORIZED refreshes the session once and reconnects', async () => {
    const { fetchMock } = renderBell({
      'GET /api/notifications/unread-count': { unreadCount: 0 },
      'POST /api/auth/refresh': { accessToken: 'token-2', user: oe },
    });
    await screen.findByRole('button', { name: 'Notifications' });
    serverEmit('connect_error', new Error('UNAUTHORIZED'));
    await waitFor(() => expect(socket.connect).toHaveBeenCalledTimes(1));
    expect(callsTo(fetchMock, 'POST', '/api/auth/refresh')).toHaveLength(1);
    // Refused again before a successful connect: don't loop.
    serverEmit('connect_error', new Error('UNAUTHORIZED'));
    serverEmit('connect_error', new Error('xhr poll error'));
    await new Promise((r) => setTimeout(r, 20));
    expect(callsTo(fetchMock, 'POST', '/api/auth/refresh')).toHaveLength(1);
  });

  it('disconnects on sign-out and does not connect without a session', async () => {
    const { rerender } = renderBell({ 'GET /api/notifications/unread-count': { unreadCount: 0 } });
    await screen.findByRole('button', { name: 'Notifications' });
    expect(io).toHaveBeenCalledTimes(1);
    rerender(null);
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
    expect(io).toHaveBeenCalledTimes(1);
  });
});

describe('task page link from a notification (F13)', () => {
  it('?fitment= opens the verification sheet when the viewer may verify, then drops the parameter', async () => {
    const fitment = makeFitment({ status: 'SUBMITTED', availableActions: ['VERIFY'], canEditVerification: true });
    mockApi({
      'GET /api/tasks/task-1': makeTask({ fitments: [fitment] }),
      'GET /api/config': { googleClientId: null, devSimulator: false },
      'GET /api/tasks/options': { oes: [], technicians: [] },
      'GET /api/fitments/fit-1/photos': { items: [], canViewHistory: true, canManage: true },
    });
    const auth: AuthContextValue = { status: 'authenticated', user: oe, login: vi.fn(), loginWithGoogle: vi.fn(), startSession: vi.fn(), logout: vi.fn() };
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AuthContext.Provider value={auth}>
          <MemoryRouter initialEntries={['/tasks/task-1?fitment=fit-1']}>
            <Routes>
              <Route path="/tasks/:id" element={<><TaskDetailPage /><LocationProbe /></>} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('dialog')).toHaveTextContent('TK-00001');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/tasks\/task-1$/));
  });
});
