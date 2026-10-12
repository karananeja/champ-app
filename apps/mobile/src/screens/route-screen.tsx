import type { DayRouteDto, RouteStopDto } from '@champ/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { AppHeader } from '../components/app-header';
import { RouteMap } from '../components/route-map';
import { NoConnection, StateView } from '../components/state-view';
import { StatusBadge } from '../components/status-badge';
import { Button, Muted } from '../components/ui';
import { api, isNetworkError } from '../lib/api-client';
import { showsBulkFill } from '../lib/bulk-fill';
import { formatIstTime } from '../lib/format';
import { requireFreshFix, tryRouteFix } from '../lib/location';
import { formatKm, formatLeg, routeQueryKey } from '../lib/route';
import { useSelectedDate } from '../lib/selected-date';
import { useTheme } from '../theme/use-theme';
import { hasSummary } from './fitment-summary-screen';

export const HOME_ORIGIN_NOTICE = 'Starting from your home location';
export const STRAIGHT_LINE_NOTICE = 'Approximate order (routing unavailable)';
export const RECALCULATE_NEEDS_GPS =
  'Recalculating needs your current location. Allow location access for Champ and make sure GPS is on, then try again.';

/** F10 §5: the day route (map, notices, timeline) for the header date. Replaces the F09 Tasks list. */
export function RouteScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { date } = useSelectedDate();
  const [recalcError, setRecalcError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: routeQueryKey(date),
    queryFn: async () => {
      const fix = await tryRouteFix();
      return api<DayRouteDto>('/mobile/route', { query: { date, lat: fix?.lat, lng: fix?.lng } });
    },
  });

  const recalc = useMutation({
    mutationFn: async () => {
      const result = await requireFreshFix();
      if (!result.ok) throw new Error(RECALCULATE_NEEDS_GPS);
      return api<DayRouteDto>('/mobile/route/recalculate', { method: 'POST', body: { date, ...result.fix } });
    },
    onMutate: () => setRecalcError(null),
    onSuccess: (route) => {
      queryClient.setQueryData(routeQueryKey(date), route);
      void queryClient.invalidateQueries({ queryKey: routeQueryKey(date) });
    },
    onError: (e) =>
      setRecalcError(isNetworkError(e) ? "Can't reach the Champ server. Try again." : e instanceof Error ? e.message : 'Could not recalculate.'),
  });

  // Submitted or later opens the task summary (F10B); everything else the fitment screen.
  const open = (s: RouteStopDto, start?: boolean) =>
    !start && hasSummary(s.fitment.status)
      ? router.push({ pathname: '/fitment/[id]/summary', params: { id: s.fitment.id } })
      : router.push({ pathname: '/fitment/[id]', params: start ? { id: s.fitment.id, start: '1' } : { id: s.fitment.id } });

  let body;
  if (query.isError && isNetworkError(query.error)) {
    body = <NoConnection onRetry={() => void query.refetch()} />;
  } else if (query.isError) {
    body = (
      <StateView illustration="server-error" title="Couldn't load your route" message={query.error.message} actionLabel="Retry" onAction={() => void query.refetch()} />
    );
  } else if (query.isPending) {
    body = <Muted style={styles.loading}>Finding your route…</Muted>;
  } else if (query.data.stops.length === 0) {
    body = (
      <FlatList
        data={[]}
        renderItem={null}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />}
        ListEmptyComponent={<StateView illustration="tasks-empty" title="No fitments" message="You have no fitments on this day." />}
      />
    );
  } else {
    const route = query.data;
    const openStops = route.stops.filter((s) => !s.done).length;
    const bulkEntryIds = bulkEntryStopIds(route.stops);
    body = (
      <>
        <View style={styles.map}>
          <RouteMap route={route} />
        </View>
        {route.origin?.source === 'HOME' ? <Notice testID="notice-home" text={HOME_ORIGIN_NOTICE} /> : null}
        {route.engine === 'STRAIGHT_LINE' ? <Notice testID="notice-straight" text={STRAIGHT_LINE_NOTICE} /> : null}
        <FlatList
          data={route.stops}
          keyExtractor={(s) => s.fitment.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />}
          ListHeaderComponent={
            <View style={styles.summary}>
              <Muted>
                {openStops} open of {route.stops.length}
                {openStops > 0 ? ` · ${formatKm(route.totalDistanceM)}` : ''}
              </Muted>
              {openStops > 0 ? (
                <Button title="Recalculate route" variant="ghost" testID="recalculate" loading={recalc.isPending} onPress={() => recalc.mutate()} />
              ) : null}
              {recalcError ? (
                <Text testID="recalculate-error" accessibilityRole="alert" style={{ color: colors.destructive }}>
                  {recalcError}
                </Text>
              ) : null}
            </View>
          }
          renderItem={({ item }) => (
            <StopRow
              stop={item}
              onOpen={() => open(item)}
              onStart={() => open(item, true)}
              onBulkFill={
                bulkEntryIds.has(item.fitment.id)
                  ? () => router.push({ pathname: '/task/[id]/bulk-fill', params: { id: item.fitment.taskId } })
                  : undefined
              }
            />
          )}
        />
      </>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AppHeader title="Route" />
      {body}
    </View>
  );
}

function Notice({ text, testID }: { text: string; testID: string }) {
  const { colors } = useTheme();
  return (
    <View testID={testID} style={[styles.notice, { backgroundColor: colors.brandSoft }]}>
      <Text style={{ color: colors.brandSoftForeground, fontSize: 13 }}>{text}</Text>
    </View>
  );
}

/** F11: the first stop of each task with two or more of my fitments carries the *Bulk fill* link. */
export function bulkEntryStopIds(stops: RouteStopDto[]): Set<string> {
  const seen = new Set<string>();
  const ids = new Set<string>();
  for (const s of stops) {
    if (seen.has(s.fitment.taskId)) continue;
    seen.add(s.fitment.taskId);
    if (showsBulkFill(s.fitment)) ids.add(s.fitment.id);
  }
  return ids;
}

function StopRow({ stop: s, onOpen, onStart, onBulkFill }: { stop: RouteStopDto; onOpen: () => void; onStart: () => void; onBulkFill?: () => void }) {
  const { colors, radius } = useTheme();
  const f = s.fitment;
  const canStart = s.isNext && f.availableActions.includes('START');
  return (
    <Pressable
      testID={`stop-${f.id}`}
      accessibilityRole="button"
      accessibilityLabel={`Stop ${s.order}, ${f.tkId}, ${f.customer}`}
      onPress={onOpen}
      style={[
        styles.row,
        { borderColor: s.isNext ? colors.primary : colors.border, backgroundColor: s.isNext ? colors.brandSoft : colors.card, borderRadius: radius + 4 },
        s.done && { opacity: 0.6 },
      ]}
    >
      <View style={[styles.num, { backgroundColor: s.done ? '#9ca3af' : s.isNext ? colors.primary : colors.muted }]}>
        <Text style={{ color: s.done || s.isNext ? '#ffffff' : colors.foreground, fontWeight: '700' }}>{s.done ? '✓' : s.order}</Text>
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowHead}>
          <Text style={[styles.tk, { color: colors.foreground }]}>
            {f.tkId}
          </Text>
          <StatusBadge status={f.status} />
        </View>
        <Text style={[styles.customer, { color: colors.foreground }]}>{f.customer}</Text>
        <Muted>
          {f.site.name} · {formatIstTime(f.fitmentAt)} IST
        </Muted>
        {s.legFromPrevious ? (
          <Text testID={`leg-${f.id}`} style={[styles.small, { color: colors.mutedForeground }]}>
            {formatLeg(s.legFromPrevious)}
          </Text>
        ) : null}
        {s.isNext ? (
          <View style={styles.rowActions}>
            <Text style={{ color: colors.primary, fontWeight: '700' }}>Next stop</Text>
            {canStart ? <Button title="Start" testID={`start-${f.id}`} onPress={onStart} /> : null}
          </View>
        ) : null}
        {!s.done && !s.isNext && s.blockedBy ? (
          <Text testID={`blocked-${f.id}`} style={[styles.small, { color: colors.mutedForeground }]}>
            After {s.blockedBy}
          </Text>
        ) : null}
        {onBulkFill ? (
          <Text testID={`bulk-fill-${f.id}`} accessibilityRole="link" onPress={onBulkFill} style={[styles.small, { color: colors.primary, fontWeight: '600' }]}>
            Bulk fill
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  map: { height: '45%' },
  loading: { padding: 24, textAlign: 'center' },
  notice: { paddingHorizontal: 16, paddingVertical: 8 },
  list: { padding: 16, gap: 10, flexGrow: 1 },
  summary: { gap: 8, marginBottom: 4 },
  row: { flexDirection: 'row', gap: 12, borderWidth: 1, padding: 12 },
  num: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, gap: 3 },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  tk: { fontSize: 16, fontWeight: '700' },
  customer: { fontSize: 15, fontWeight: '600' },
  small: { fontSize: 14 },
  rowActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
});
