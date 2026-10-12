import { useCallback, useEffect, useRef } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { toast } from 'sonner';
import {
  NOTIFICATION_COUNT_EVENT,
  NOTIFICATION_EVENT,
  NOTIFICATION_SOCKET_PATH,
  type NotificationDto,
  type NotificationListResponse,
} from '@champ/shared';
import { api, getAccessToken, refreshSession, withQuery } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export const notificationKeys = {
  all: ['notifications'] as const,
  list: ['notifications', 'list'] as const,
  count: ['notifications', 'count'] as const,
};

type ListData = InfiniteData<NotificationListResponse, string | undefined>;
interface CountData {
  unreadCount: number;
}

const PAGE_SIZE = 20;

/** The unread count for the bell badge. */
export const useUnreadCount = () =>
  useQuery({ queryKey: notificationKeys.count, queryFn: () => api<CountData>('/notifications/unread-count') });

/** The caller's notifications, newest first, a page at a time (fetched only while the list is open). */
export const useNotificationList = (enabled: boolean) =>
  useInfiniteQuery({
    queryKey: notificationKeys.list,
    queryFn: ({ pageParam }) => api<NotificationListResponse>(withQuery('/notifications', { cursor: pageParam, limit: PAGE_SIZE })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });

const setCount = (client: QueryClient, unreadCount: number) => client.setQueryData<CountData>(notificationKeys.count, { unreadCount });

/**
 * A count from the server's live events is newer than any count request still in flight: cancel that request
 * first, or its late answer would overwrite this one (CR-11; the app does the same).
 */
export function setLiveCount(client: QueryClient, unreadCount: number) {
  void client.cancelQueries({ queryKey: notificationKeys.count });
  setCount(client, unreadCount);
}

const mapItems = (client: QueryClient, fn: (items: NotificationDto[], pageIndex: number) => NotificationDto[]) =>
  client.setQueryData<ListData>(notificationKeys.list, (data) =>
    data && { ...data, pages: data.pages.map((page, i) => ({ ...page, items: fn(page.items, i) })) },
  );

/** A live notification: on top of the list (a grouped one replaces its older copy) and the new count. */
export function receiveNotification(client: QueryClient, notification: NotificationDto, unreadCount: number) {
  mapItems(client, (items, i) => {
    const rest = items.filter((n) => n.id !== notification.id);
    return i === 0 ? [notification, ...rest] : rest;
  });
  setLiveCount(client, unreadCount);
}

export function useMarkRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/notifications/${id}/read`, { method: 'POST' }),
    onMutate: (id) => {
      const list = client.getQueryData<ListData>(notificationKeys.list);
      const wasUnread = list?.pages.some((p) => p.items.some((n) => n.id === id && !n.read)) ?? true;
      mapItems(client, (items) => items.map((n) => (n.id === id ? { ...n, read: true } : n)));
      const count = client.getQueryData<CountData>(notificationKeys.count);
      if (count && wasUnread) setCount(client, Math.max(0, count.unreadCount - 1));
    },
    onSettled: () => client.invalidateQueries({ queryKey: notificationKeys.count }),
  });
}

export function useMarkAllRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>('/notifications/read-all', { method: 'POST' }),
    onSuccess: () => {
      mapItems(client, (items) => items.map((n) => ({ ...n, read: true })));
      setCount(client, 0);
    },
  });
}

/**
 * Where a notification leads: the task (with `?fitment=` so the task page opens the fitment's verification
 * sheet when the viewer may see it) or the travel task's sheet.
 */
export function notificationPath(notification: NotificationDto): string {
  const { target } = notification;
  if (target.kind === 'TRAVEL') return withQuery('/tasks/travel', { tt: target.travelTaskId });
  return withQuery(`/tasks/${target.taskId}`, { fitment: target.fitmentId });
}

/** Marks a notification read (if it isn't) and opens what it is about. */
export function useOpenNotification() {
  const navigate = useNavigate();
  const markRead = useMarkRead();
  const { mutate } = markRead;
  return useCallback(
    (notification: NotificationDto) => {
      if (!notification.read) mutate(notification.id);
      navigate(notificationPath(notification));
    },
    [mutate, navigate],
  );
}

/**
 * The live connection (D-230) while signed in: authenticates with the current access token, refreshes the
 * session once and reconnects when the server refuses it (expired token), puts live notifications in the
 * cache with a toast, keeps the count in step with the user's other tabs, and disconnects on sign-out.
 */
export function useNotificationSocket() {
  const { status, user } = useAuth();
  const userId = status === 'authenticated' ? user?.id : undefined;
  const client = useQueryClient();
  const open = useOpenNotification();
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!userId) return;
    let refreshed = false;
    const socket = io({ path: NOTIFICATION_SOCKET_PATH, auth: (cb) => cb({ token: getAccessToken() }) });

    socket.on('connect', () => {
      refreshed = false;
      // Catch up on anything that arrived while disconnected.
      void client.invalidateQueries({ queryKey: notificationKeys.all });
    });
    socket.on('connect_error', (error: Error) => {
      if (error.message !== 'UNAUTHORIZED' || refreshed) return;
      refreshed = true;
      void refreshSession().then((session) => {
        if (session) socket.connect();
      });
    });
    socket.on(NOTIFICATION_EVENT, ({ notification, unreadCount }: { notification: NotificationDto; unreadCount: number }) => {
      receiveNotification(client, notification, unreadCount);
      toast(notification.title, {
        description: notification.body ?? undefined,
        action: { label: 'View', onClick: () => openRef.current(notification) },
      });
    });
    socket.on(NOTIFICATION_COUNT_EVENT, ({ unreadCount }: CountData) => {
      setLiveCount(client, unreadCount);
      void client.invalidateQueries({ queryKey: notificationKeys.list });
    });

    return () => {
      socket.disconnect();
    };
  }, [userId, client]);
}
