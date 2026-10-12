import type { NotificationDto } from '@champ/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { makeNotification } from '../test/notification-fixtures';
import { mockFetch, renderWithProviders, router } from '../test/utils';
import { NotificationsScreen } from './notifications-screen';

jest.mock('socket.io-client', () => ({ io: jest.fn() }));

const FIRST: NotificationDto[] = [
  makeNotification({ id: 'n1', type: 'FITMENT_SUBMITTED', title: 'TK-00012 submitted by Arjun · ready to verify' }),
  makeNotification({ id: 'n2', type: 'FITMENT_ASSIGNED', title: 'TK-00013 assigned to you', target: { kind: 'FITMENT', taskId: 't1', fitmentId: 'f2' } }),
  makeNotification({ id: 'n3', type: 'TRAVEL_VERIFIED', title: 'Travel task TT-00004 verified', body: null, read: true, target: { kind: 'TRAVEL', travelTaskId: 'tt1' } }),
];
const SECOND = [makeNotification({ id: 'n4', title: 'TK-00001 approved', type: 'FITMENT_APPROVED', read: true })];

function notificationsApi(pages: { items: NotificationDto[]; nextCursor: string | null }[] = [{ items: FIRST, nextCursor: 'c2' }, { items: SECOND, nextCursor: null }]) {
  return mockFetch((url, init) => {
    if (url.pathname === '/api/notifications') {
      const page = url.searchParams.get('cursor') === 'c2' ? pages[1] : pages[0];
      return { status: 200, body: { ...page, unreadCount: 2 } };
    }
    if (init.method === 'POST' && url.pathname.startsWith('/api/notifications/')) return { status: 204 };
    return { status: 404 };
  });
}

beforeEach(() => jest.clearAllMocks());

describe('NotificationsScreen', () => {
  it('lists title, body, time and unread dots, and loads more at the end', async () => {
    const fetchMock = notificationsApi();
    await renderWithProviders(<NotificationsScreen />);
    expect(await screen.findByText('TK-00012 submitted by Arjun · ready to verify')).toBeOnTheScreen();
    expect(screen.getAllByText('Zoomcar · Bengaluru depot · 14 Oct, 10:00 am')).toHaveLength(2);
    expect(screen.getAllByText('Just now')).toHaveLength(3);
    expect(screen.getByTestId('unread-n1')).toBeOnTheScreen();
    expect(screen.queryByTestId('unread-n3')).toBeNull();
    await fireEvent(screen.getByTestId('notification-list'), 'onEndReached');
    expect(await screen.findByText('TK-00001 approved')).toBeOnTheScreen();
    expect(new URL(fetchMock.mock.calls.at(-1)?.[0] as string).searchParams.get('cursor')).toBe('c2');
  });

  it('Mark all as read posts read-all and clears the dots', async () => {
    const fetchMock = notificationsApi();
    await renderWithProviders(<NotificationsScreen />);
    await screen.findByTestId('unread-n1');
    await fireEvent.press(screen.getByTestId('mark-all-read'));
    await waitFor(() => expect(screen.queryByTestId('unread-n1')).toBeNull());
    expect(screen.queryByTestId('unread-n2')).toBeNull();
    expect(fetchMock.mock.calls.some(([u, i]) => String(u).endsWith('/api/notifications/read-all') && (i as RequestInit).method === 'POST')).toBe(true);
    expect(screen.queryByTestId('mark-all-read')).toBeNull();
  });

  it('a tap marks it read and opens Approve visit for a submission', async () => {
    const fetchMock = notificationsApi();
    await renderWithProviders(<NotificationsScreen />);
    await fireEvent.press(await screen.findByTestId('notification-n1'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/approve-visit/[id]', params: { id: 'f1' } });
    await waitFor(() => expect(screen.queryByTestId('unread-n1')).toBeNull());
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/api/notifications/n1/read'))).toBe(true);
  });

  it('opens the fitment for an assignment and home for travel (already read: no request)', async () => {
    const fetchMock = notificationsApi();
    await renderWithProviders(<NotificationsScreen />);
    await fireEvent.press(await screen.findByTestId('notification-n2'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/fitment/[id]', params: { id: 'f2' } });
    const before = fetchMock.mock.calls.length;
    await fireEvent.press(screen.getByTestId('notification-n3'));
    expect(router.push).toHaveBeenLastCalledWith('/home');
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it("shows You're all caught up when there are none", async () => {
    notificationsApi([{ items: [], nextCursor: null }, { items: [], nextCursor: null }]);
    await renderWithProviders(<NotificationsScreen />);
    expect(await screen.findByText("You're all caught up")).toBeOnTheScreen();
  });
});
