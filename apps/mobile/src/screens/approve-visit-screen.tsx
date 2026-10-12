import type { ApproveVisitListResponse } from '@champ/shared';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NoConnection, StateView } from '../components/state-view';
import { Muted } from '../components/ui';
import { api, isNetworkError } from '../lib/api-client';
import { dateLabel, formatIstTime } from '../lib/format';
import { approveVisitListKey } from '../lib/history';
import { useSelectedDate } from '../lib/selected-date';
import { useTheme } from '../theme/use-theme';

export const fetchApproveVisitList = (date: string) => api<ApproveVisitListResponse>('/mobile/approve-visit', { query: { date } });

/** F12 §5: the OE's submitted fitments waiting for verification on the selected date (same filter as the Home tile). */
export function ApproveVisitScreen() {
  const { colors, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { date } = useSelectedDate();
  const query = useQuery({ queryKey: approveVisitListKey(date), queryFn: () => fetchApproveVisitList(date) });

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 8, borderColor: colors.border }]}>
      <Pressable testID="back" accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={12}>
        <Text style={{ color: colors.primary, fontSize: 17, fontWeight: '600' }}>‹ Back</Text>
      </Pressable>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
        Approve visit
      </Text>
      <Text style={{ color: colors.mutedForeground }}>{dateLabel(date)}</Text>
    </View>
  );

  let body;
  if (query.isError && !query.data) {
    body = isNetworkError(query.error) ? (
      <NoConnection onRetry={() => void query.refetch()} />
    ) : (
      <StateView illustration="server-error" title="Couldn't load the list" message={query.error.message} actionLabel="Retry" onAction={() => void query.refetch()} />
    );
  } else if (!query.data) {
    body = <Muted style={{ padding: 24, textAlign: 'center' }}>Loading…</Muted>;
  } else {
    body = (
      <FlatList
        data={query.data.items}
        keyExtractor={(i) => i.fitmentId}
        contentContainerStyle={query.data.items.length ? [styles.list, { paddingBottom: insets.bottom + 24 }] : { flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />}
        ListEmptyComponent={<StateView illustration="tasks-empty" title="Nothing waiting for you on this day" />}
        renderItem={({ item }) => (
          <Pressable
            testID={`visit-${item.fitmentId}`}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/approve-visit/[id]', params: { id: item.fitmentId } })}
            style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius + 4 }]}
          >
            <View style={styles.rowHead}>
              <Text style={[styles.tk, { color: colors.foreground }]}>{item.tkId}</Text>
              {item.submittedAt ? <Muted>Submitted {formatIstTime(item.submittedAt)}</Muted> : null}
            </View>
            <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: '600' }}>{item.technician?.name ?? 'Unassigned'}</Text>
            <Muted>
              {item.customer} · {item.site.name}
            </Muted>
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
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  tk: { fontSize: 16, fontWeight: '700' },
});
