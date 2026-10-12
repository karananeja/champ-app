import type { MobileHomeResponse } from '@champ/shared';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppHeader } from '../components/app-header';
import { NoConnection } from '../components/state-view';
import { Muted } from '../components/ui';
import { api, isNetworkError } from '../lib/api-client';
import { useSelectedDate } from '../lib/selected-date';
import { useSession } from '../lib/session';
import { useTheme } from '../theme/use-theme';

export const homeQueryKey = (date: string) => ['mobile-home', date] as const;

/** M3: Show tasks for everyone; Approve visit for OE (D-014; its screen comes in F12). */
export function HomeScreen() {
  const { colors, radius } = useTheme();
  const router = useRouter();
  const { user } = useSession();
  const { date } = useSelectedDate();
  const query = useQuery({
    queryKey: homeQueryKey(date),
    queryFn: () => api<MobileHomeResponse>('/mobile/home', { query: { date } }),
  });

  if (query.isError && isNetworkError(query.error)) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <AppHeader title="Home" />
        <NoConnection onRetry={() => void query.refetch()} />
      </View>
    );
  }

  const count = (n: number | null | undefined) => (query.isPending ? '–' : String(n ?? 0));
  const tileStyle = [styles.tile, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius + 4 }];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AppHeader title="Home" />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />}
      >
        <Muted>Hello, {user?.name.split(' ')[0]}</Muted>
        <Pressable
          testID="tile-show-tasks"
          accessibilityRole="button"
          accessibilityLabel={`Show tasks, ${count(query.data?.showTasks)}`}
          onPress={() => router.push('/route')}
          style={tileStyle}
        >
          <Text style={[styles.count, { color: colors.primary }]}>{count(query.data?.showTasks)}</Text>
          <Text style={[styles.tileTitle, { color: colors.foreground }]}>Show tasks</Text>
          <Muted>Your fitments for this day</Muted>
        </Pressable>
        {user?.role === 'OE' ? (
          <View testID="tile-approve-visit" accessibilityLabel={`Approve visit, ${count(query.data?.approveVisit)}`} style={tileStyle}>
            <Text style={[styles.count, { color: colors.primary }]}>{count(query.data?.approveVisit)}</Text>
            <Text style={[styles.tileTitle, { color: colors.foreground }]}>Approve visit</Text>
            <Muted>Coming in a later update</Muted>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  tile: { borderWidth: 1, padding: 20, gap: 4 },
  count: { fontSize: 36, fontWeight: '800' },
  tileTitle: { fontSize: 18, fontWeight: '600' },
});
