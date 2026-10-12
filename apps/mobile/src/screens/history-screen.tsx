import type { DayHistoryDto, ReporteesHistoryResponse } from '@champ/shared';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { AppHeader } from '../components/app-header';
import { DayTimeline } from '../components/day-timeline';
import { NoConnection, StateView } from '../components/state-view';
import { Muted } from '../components/ui';
import { api, isNetworkError } from '../lib/api-client';
import { fitmentCount, formatDistance, historyQueryKey, reporteesQueryKey } from '../lib/history';
import { useSelectedDate } from '../lib/selected-date';
import { useSession } from '../lib/session';
import { useTheme } from '../theme/use-theme';

type Tab = 'personal' | 'reportees';

/** F12 §5: my day (and, for an OE, my direct reportees' days) with the distance travelled. */
export function HistoryScreen() {
  const { colors } = useTheme();
  const { user } = useSession();
  const [tab, setTab] = useState<Tab>('personal');
  const isOe = user?.role === 'OE';

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AppHeader title="History" />
      {isOe ? (
        <View style={[styles.tabs, { borderColor: colors.border }]} accessibilityRole="tablist">
          {(
            [
              ['personal', 'Personal'],
              ['reportees', 'Direct reportees'],
            ] as const
          ).map(([value, label]) => {
            const selected = tab === value;
            return (
              <Pressable
                key={value}
                testID={`tab-${value}`}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => setTab(value)}
                style={[styles.tab, selected && { backgroundColor: colors.brandSoft }]}
              >
                <Text style={{ color: selected ? colors.brandSoftForeground : colors.foreground, fontWeight: '600' }}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {isOe && tab === 'reportees' ? <ReporteesList /> : <PersonalTimeline />}
    </View>
  );
}

/** A person's timeline for the selected date; `userId` for a reportee (read only). */
export function useDayHistory(userId?: string) {
  const { date } = useSelectedDate();
  return useQuery({
    queryKey: historyQueryKey(date, userId),
    queryFn: () => api<DayHistoryDto>('/mobile/history', { query: { date, userId } }),
  });
}

export function HistoryBody({ query, onOpen }: { query: ReturnType<typeof useDayHistory>; onOpen?: Parameters<typeof DayTimeline>[0]['onOpen'] }) {
  if (query.isError && !query.data) {
    return isNetworkError(query.error) ? (
      <NoConnection onRetry={() => void query.refetch()} />
    ) : (
      <StateView illustration="server-error" title="Couldn't load the history" message={query.error.message} actionLabel="Retry" onAction={() => void query.refetch()} />
    );
  }
  if (!query.data) return <Muted style={{ padding: 24, textAlign: 'center' }}>Loading…</Muted>;
  return <DayTimeline day={query.data} refreshing={query.isRefetching} onRefresh={() => void query.refetch()} onOpen={onOpen} />;
}

function PersonalTimeline() {
  const router = useRouter();
  const query = useDayHistory();
  return <HistoryBody query={query} onOpen={(e) => router.push({ pathname: '/fitment/[id]/summary', params: { id: e.fitmentId } })} />;
}

function ReporteesList() {
  const { colors, radius } = useTheme();
  const router = useRouter();
  const { date } = useSelectedDate();
  const query = useQuery({
    queryKey: reporteesQueryKey(date),
    queryFn: () => api<ReporteesHistoryResponse>('/mobile/history/reportees', { query: { date } }),
  });

  if (query.isError && !query.data) {
    return isNetworkError(query.error) ? (
      <NoConnection onRetry={() => void query.refetch()} />
    ) : (
      <StateView illustration="server-error" title="Couldn't load your reportees" message={query.error.message} actionLabel="Retry" onAction={() => void query.refetch()} />
    );
  }
  if (!query.data) return <Muted style={{ padding: 24, textAlign: 'center' }}>Loading…</Muted>;

  return (
    <FlatList
      data={query.data.items}
      keyExtractor={(r) => r.user.id}
      contentContainerStyle={query.data.items.length ? styles.list : { flexGrow: 1 }}
      refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />}
      ListEmptyComponent={<StateView illustration="tasks-empty" title="No direct reportees" />}
      renderItem={({ item }) => (
        <Pressable
          testID={`reportee-${item.user.id}`}
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/history/[id]', params: { id: item.user.id, name: item.user.name } })}
          style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius + 4 }]}
        >
          <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: '600' }}>{item.user.name}</Text>
          <Muted>
            {fitmentCount(item.startedCount)} · {formatDistance(item.distanceM, item.approx)}
          </Muted>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 999 },
  list: { padding: 16, gap: 8 },
  row: { borderWidth: 1, padding: 14, gap: 4 },
});
