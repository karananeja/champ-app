import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { dateLabel } from '../lib/format';
import { useSelectedDate } from '../lib/selected-date';
import { useTheme } from '../theme/use-theme';
import { HistoryBody, useDayHistory } from './history-screen';

/** F12 §5: a direct reportee's timeline for the selected date, read only (D-218). */
export function ReporteeHistoryScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { date } = useSelectedDate();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const query = useDayHistory(id);
  const title = query.data?.user.name ?? name ?? 'History';

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: insets.top + 8, borderColor: colors.border }]}>
        <Pressable testID="back" accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={12}>
          <Text style={{ color: colors.primary, fontSize: 17, fontWeight: '600' }}>‹ Back</Text>
        </Pressable>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={{ color: colors.mutedForeground }}>{dateLabel(date)}</Text>
      </View>
      <HistoryBody query={query} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { flex: 1, fontSize: 20, fontWeight: '700' },
});
