import type { MyFitmentDto, MyFitmentsResponse } from '@champ/shared';
import { useQuery } from '@tanstack/react-query';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { AppHeader } from '../components/app-header';
import { NoConnection, StateView } from '../components/state-view';
import { StatusBadge } from '../components/status-badge';
import { Card, Muted } from '../components/ui';
import { api, isNetworkError } from '../lib/api-client';
import { formatIstTime } from '../lib/format';
import { useSelectedDate } from '../lib/selected-date';
import { useTheme } from '../theme/use-theme';

export const fitmentsQueryKey = (date: string) => ['mobile-fitments', date] as const;

/** D-131: a read-only list of my fitments for the header date. Route order and execution come in F10. */
export function TasksScreen() {
  const { colors } = useTheme();
  const { date } = useSelectedDate();
  const query = useQuery({
    queryKey: fitmentsQueryKey(date),
    queryFn: () => api<MyFitmentsResponse>('/mobile/fitments', { query: { date } }),
  });

  let body;
  if (query.isError && isNetworkError(query.error)) {
    body = <NoConnection onRetry={() => void query.refetch()} />;
  } else if (query.isError) {
    body = (
      <StateView illustration="server-error" title="Couldn't load tasks" message={query.error.message} actionLabel="Retry" onAction={() => void query.refetch()} />
    );
  } else {
    body = (
      <FlatList
        data={query.data?.items ?? []}
        keyExtractor={(f) => f.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />}
        renderItem={({ item }) => <FitmentCard fitment={item} />}
        ListEmptyComponent={
          query.isPending ? null : (
            <StateView illustration="tasks-empty" title="No tasks" message="You have no fitments on this day." />
          )
        }
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AppHeader title="Tasks" />
      {body}
    </View>
  );
}

function FitmentCard({ fitment: f }: { fitment: MyFitmentDto }) {
  const { colors } = useTheme();
  return (
    <Card testID={`fitment-${f.id}`}>
      <View style={styles.row}>
        <Text style={[styles.tk, { color: colors.foreground }]}>{f.tkId}</Text>
        <StatusBadge status={f.status} />
      </View>
      <Muted>{formatIstTime(f.fitmentAt)} IST</Muted>
      <Text style={[styles.customer, { color: colors.foreground }]}>{f.customer}</Text>
      <Text style={{ color: colors.foreground }}>{f.site.name}</Text>
      {f.site.address ? <Muted>{f.site.address}</Muted> : null}
      <Muted>
        {f.vehicleRegNo ?? 'No vehicle'} · {f.activity}
      </Muted>
    </Card>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 12, flexGrow: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  tk: { fontSize: 16, fontWeight: '700' },
  customer: { fontSize: 16, fontWeight: '600' },
});
