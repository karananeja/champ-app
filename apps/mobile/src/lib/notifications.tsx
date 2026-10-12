import {
  IST_TIME_ZONE,
  NOTIFICATION_COUNT_EVENT,
  NOTIFICATION_EVENT,
  NOTIFICATION_SOCKET_PATH,
  type NotificationDto,
  type NotificationListResponse,
} from '@champ/shared';
import { useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import type { Href } from 'expo-router';
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { io } from 'socket.io-client';
import { useToast } from '../components/toast';
import { api, getAccessToken, refreshSession } from './api-client';
import { resolveApiOrigin } from './api-base-url';
import { useSession } from './session';

export const notificationListKey = ['notifications', 'list'] as const;
export const unreadCountKey = ['notifications', 'unread-count'] as const;
/** Screens a live notification may have changed (§6): refetched when one arrives. */
const LIVE_STALE_KEYS = [['mobile-home'], ['mobile-route'], ['mobile-approve-visit'], ['mobile-fitments'], ['mobile-fitment']] as const;

export type NotificationPages = InfiniteData<NotificationListResponse, string | null>;

export const fetchNotifications = (cursor: string | null) =>
  api<NotificationListResponse>('/notifications', { query: { cursor: cursor ?? undefined, limit: 20 } });
const fetchUnreadCount = () => api<{ unreadCount: number }>('/notifications/unread-count').then((r) => r.unreadCount);

/** Puts a new or regrouped notification at the top of the first page (a regrouped one replaces its old row). */
function prependToList(client: QueryClient, n: NotificationDto) {
  client.setQueryData<NotificationPages>(notificationListKey, (data) => {
    if (!data) return data;
    const pages = data.pages.map((p, i) => ({
      ...p,
      items: i === 0 ? [n, ...p.items.filter((x) => x.id !== n.id)] : p.items.filter((x) => x.id !== n.id),
    }));
    return { ...data, pages };
  });
}

/** Marks one notification (or all, when `id` is null) read in the cached list and count. */
export function markReadInCache(client: QueryClient, id: string | null) {
  client.setQueryData<NotificationPages>(notificationListKey, (data) =>
    data
      ? { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map((x) => (id === null || x.id === id ? { ...x, read: true } : x)) })) }
      : data,
  );
  client.setQueryData<number>(unreadCountKey, (c) => (id === null ? 0 : Math.max(0, (c ?? 0) - 1)));
}

const NotificationsContext = createContext<{ unreadCount: number }>({ unreadCount: 0 });
export const useUnreadCount = (): number => useContext(NotificationsContext).unreadCount;

/**
 * F13 §6: while signed in, holds the unread count and one Socket.IO connection to the API (D-230). A live
 * notification updates the count and the list, shows a toast and refetches the screens it may have changed.
 * UNAUTHORIZED on connect → refresh the access token once and reconnect; back in the foreground → reconnect.
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const signedIn = status === 'signed-in';
  const client = useQueryClient();
  const toast = useToast();
  const count = useQuery({ queryKey: unreadCountKey, queryFn: fetchUnreadCount, enabled: signedIn });

  useEffect(() => {
    if (!signedIn) return;
    const socket = io(resolveApiOrigin(), {
      path: NOTIFICATION_SOCKET_PATH,
      transports: ['websocket'],
      // Read on every (re)connect, so a refreshed token is picked up.
      auth: (cb) => cb({ token: getAccessToken() }),
    });
    let refreshed = false;
    socket.on('connect', () => {
      refreshed = false;
    });
    socket.on('connect_error', (err: Error) => {
      if (err.message !== 'UNAUTHORIZED' || refreshed) return;
      refreshed = true;
      void refreshSession()
        .then((r) => {
          if (r) socket.connect();
        })
        .catch(() => {});
    });
    // A live count is newer than any count request still in flight: cancel it, or its late answer would overwrite this one.
    const setLiveCount = (n: number) => {
      void client.cancelQueries({ queryKey: unreadCountKey });
      client.setQueryData(unreadCountKey, n);
    };
    socket.on(NOTIFICATION_EVENT, (p: { notification: NotificationDto; unreadCount: number }) => {
      setLiveCount(p.unreadCount);
      prependToList(client, p.notification);
      toast(p.notification.title);
      for (const queryKey of LIVE_STALE_KEYS) void client.invalidateQueries({ queryKey: [...queryKey] });
    });
    socket.on(NOTIFICATION_COUNT_EVENT, (p: { unreadCount: number }) => {
      setLiveCount(p.unreadCount);
      void client.invalidateQueries({ queryKey: notificationListKey });
    });
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      if (!socket.connected) socket.connect();
      // Anything that arrived while the socket was asleep.
      void client.invalidateQueries({ queryKey: ['notifications'] });
    });
    return () => {
      sub.remove();
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [signedIn, client, toast]);

  const value = useMemo(() => ({ unreadCount: signedIn ? (count.data ?? 0) : 0 }), [signedIn, count.data]);
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

/**
 * Where a tap goes (§6): the technician's notifications (assigned, approved, reopened) open the fitment, a
 * submission opens Approve visit for the OE; everything else (travel, grouped without a fitment) goes home.
 */
export function notificationHref(n: NotificationDto): Href {
  if (n.target.kind === 'FITMENT' && n.target.fitmentId) {
    const id = n.target.fitmentId;
    // The technician opens the fitment (also when a fault marking was undone, CR-11); the task's OE (submitted,
    // approved, reopened by an OM) opens it in Approve visit.
    if (
      n.forTechnician &&
      (n.type === 'FITMENT_ASSIGNED' || n.type === 'FITMENT_APPROVED' || n.type === 'FITMENT_REOPENED' || n.type === 'FITMENT_FAULT_UNDONE')
    ) {
      return { pathname: '/fitment/[id]', params: { id } };
    }
    if (!n.forTechnician && (n.type === 'FITMENT_SUBMITTED' || n.type === 'FITMENT_APPROVED' || n.type === 'FITMENT_REOPENED')) {
      return { pathname: '/approve-visit/[id]', params: { id } };
    }
  }
  return '/home';
}

const dateTimeFormat = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
  timeZone: IST_TIME_ZONE,
});

/** "Just now", "5 min ago", "3 h ago", then the IST date and time ("14 Oct, 10:00 am"). */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const min = Math.floor((now.getTime() - Date.parse(iso)) / 60_000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.floor(min / 60)} h ago`;
  return dateTimeFormat.format(new Date(iso));
}
