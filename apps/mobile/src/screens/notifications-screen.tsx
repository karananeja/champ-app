import type { NotificationDto } from '@champ/shared';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NoConnection, StateView } from '../components/state-view';
import { Muted } from '../components/ui';
import { api, isNetworkError } from '../lib/api-client';
import {
  fetchNotifications,
  markReadInCache,
  notificationHref,
  notificationListKey,
  relativeTime,
  unreadCountKey,
  useUnreadCount,
} from '../lib/notifications';
import { useTheme } from '../theme/use-theme';

/** F13 §6: the user's notifications, newest first. Tap → mark read, then open what it's about. */
export function NotificationsScreen() {
  const { colors, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const client = useQueryClient();
  const unread = useUnreadCount();

  const query = useInfiniteQuery({
    queryKey: notificationListKey,
    queryFn: ({ pageParam }) => fetchNotifications(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 0,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const anyUnread = unread > 0 || items.some((n) => !n.read);

  const markAll = useMutation({
    mutationFn: () => api('/notifications/read-all', { method: 'POST' }),
    onSuccess: () => markReadInCache(client, null),
  });

  const open = (n: NotificationDto) => {
    if (!n.read) {
      markReadInCache(client, n.id);
      void api(`/notifications/${encodeURIComponent(n.id)}/read`, { method: 'POST' }).catch(() =>
        client.invalidateQueries({ queryKey: unreadCountKey }),
      );
    }
    router.push(notificationHref(n));
  };

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 8, borderColor: colors.border }]}>
      <Pressable testID="back" accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={12}>
        <Text style={{ color: colors.primary, fontSize: 17, fontWeight: '600' }}>‹ Back</Text>
      </Pressable>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
        Notifications
      </Text>
      {anyUnread ? (
        <Pressable testID="mark-all-read" accessibilityRole="button" disabled={markAll.isPending} onPress={() => markAll.mutate()} hitSlop={8}>
          <Text style={{ color: colors.primary, fontWeight: '600' }}>Mark all as read</Text>
        </Pressable>
      ) : null}
    </View>
  );

  let body;
  if (query.isError && !query.data) {
    body = isNetworkError(query.error) ? (
      <NoConnection onRetry={() => void query.refetch()} />
    ) : (
      <StateView illustration="server-error" title="Couldn't load notifications" message={query.error.message} actionLabel="Retry" onAction={() => void query.refetch()} />
    );
  } else if (!query.data) {
    body = <Muted style={{ padding: 24, textAlign: 'center' }}>Loading…</Muted>;
  } else {
    body = (
      <FlatList
        data={items}
        testID="notification-list"
        keyExtractor={(n) => n.id}
        contentContainerStyle={items.length ? [styles.list, { paddingBottom: insets.bottom + 24 }] : { flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={query.isRefetching && !query.isFetchingNextPage} onRefresh={() => void query.refetch()} />}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={<StateView illustration="tasks-empty" title="You're all caught up" message="New notifications show up here." />}
        ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator color={colors.primary} style={{ padding: 16 }} /> : null}
        renderItem={({ item }) => (
          <Pressable
            testID={`notification-${item.id}`}
            accessibilityRole="button"
            accessibilityLabel={`${item.read ? '' : 'Unread. '}${item.title}`}
            onPress={() => open(item)}
            style={[
              styles.row,
              { backgroundColor: item.read ? colors.card : colors.brandSoft, borderColor: colors.border, borderRadius: radius + 4 },
            ]}
          >
            <View style={styles.rowHead}>
              {item.read ? null : <View testID={`unread-${item.id}`} style={[styles.dot, { backgroundColor: colors.primary }]} />}
              <Text style={[styles.rowTitle, { color: colors.foreground, fontWeight: item.read ? '500' : '700' }]}>{item.title}</Text>
            </View>
            {item.body ? <Muted>{item.body}</Muted> : null}
            <Muted style={{ fontSize: 12 }}>{relativeTime(item.createdAt)}</Muted>
          </Pressable>
        )}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {header}
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { flex: 1, fontSize: 20, fontWeight: '700' },
  list: { padding: 16, gap: 8 },
  row: { borderWidth: 1, padding: 14, gap: 4 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowTitle: { flex: 1, fontSize: 15 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
