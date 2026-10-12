import { useState } from 'react';
import { Bell, CheckCheck, Loader2 } from 'lucide-react';
import type { NotificationDto } from '@champ/shared';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { badgeText, notificationTime } from './notification-format';
import { useMarkAllRead, useNotificationList, useNotificationSocket, useOpenNotification, useUnreadCount } from './use-notifications';

function NotificationItem({ notification, onOpen }: { notification: NotificationDto; onOpen: (n: NotificationDto) => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(notification)}
        className={cn('flex w-full gap-3 px-4 py-3 text-left hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none', !notification.read && 'bg-brand-soft/40')}
        data-testid="notification-item"
        data-unread={!notification.read || undefined}
      >
        <span
          className={cn('mt-1.5 size-2 shrink-0 rounded-full', notification.read ? 'bg-transparent' : 'bg-primary')}
          aria-label={notification.read ? undefined : 'Unread'}
        />
        <span className="min-w-0 flex-1">
          <span className={cn('block text-sm break-words', !notification.read && 'font-medium')}>{notification.title}</span>
          {notification.body && <span className="block text-xs break-words text-muted-foreground">{notification.body}</span>}
          <span className="mt-0.5 block text-xs text-muted-foreground">{notificationTime(notification.createdAt)}</span>
        </span>
      </button>
    </li>
  );
}

/** The top-bar bell (F13): unread badge, the latest notifications in a popover, live delivery while signed in. */
export function NotificationBell() {
  useNotificationSocket();
  const [open, setOpen] = useState(false);
  const unread = useUnreadCount().data?.unreadCount ?? 0;
  const list = useNotificationList(open);
  const markAll = useMarkAllRead();
  const openNotification = useOpenNotification();
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
          <Bell />
          {unread > 0 && (
            <span
              className="absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] leading-none font-semibold text-white ring-2 ring-background"
              aria-hidden="true"
              data-testid="notification-badge"
            >
              {badgeText(unread)}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0" aria-label="Notifications">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
          <h2 className="text-sm font-semibold">Notifications</h2>
          <Button variant="ghost" size="sm" disabled={unread === 0 || markAll.isPending} onClick={() => markAll.mutate()}>
            <CheckCheck /> Mark all as read
          </Button>
        </div>
        <div className="max-h-[min(28rem,70vh)] overflow-y-auto">
          {list.isPending ? (
            <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </div>
          ) : list.isError ? (
            <div className="grid justify-items-center gap-2 p-6 text-sm text-muted-foreground">
              Could not load notifications.
              <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
                Try again
              </Button>
            </div>
          ) : items.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">You're all caught up</p>
          ) : (
            <ul className="divide-y">
              {items.map((n) => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  onOpen={(target) => {
                    setOpen(false);
                    openNotification(target);
                  }}
                />
              ))}
            </ul>
          )}
          {list.hasNextPage && (
            <div className="border-t p-2 text-center">
              <Button variant="ghost" size="sm" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                {list.isFetchingNextPage && <Loader2 className="animate-spin" />} Load more
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
