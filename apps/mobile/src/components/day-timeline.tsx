import type { DayHistoryDto, TimelineEntryDto } from '@champ/shared';
import { Fragment } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { fitmentCount, formatDistance, formatKm } from '../lib/history';
import { formatIstTime } from '../lib/format';
import { useTheme } from '../theme/use-theme';
import { StateView } from './state-view';
import { StatusBadge } from './status-badge';
import { Muted } from './ui';

/**
 * F12: one person's day — the distance and started count, then each fitment with that day's steps (IST times) and
 * the driving distance between consecutive started fitments. `onOpen` is left out for a reportee (read only).
 */
export function DayTimeline({
  day,
  refreshing,
  onRefresh,
  onOpen,
}: {
  day: DayHistoryDto;
  refreshing: boolean;
  onRefresh: () => void;
  onOpen?: (entry: TimelineEntryDto) => void;
}) {
  const { colors, radius } = useTheme();
  const refresh = <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />;

  if (day.entries.length === 0) {
    return (
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} refreshControl={refresh}>
        <StateView illustration="tasks-empty" title="Nothing done on this day" />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} refreshControl={refresh}>
      <Text testID="history-totals" style={[styles.totals, { color: colors.foreground }]}>
        {formatDistance(day.distanceM, day.approx)} · {fitmentCount(day.startedCount)}
      </Text>
      {day.entries.map((e) => {
        const card = (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius + 4 }]}>
            <View style={styles.rowHead}>
              <Text style={[styles.tk, { color: colors.foreground }]}>{e.tkId}</Text>
              <StatusBadge status={e.status} />
            </View>
            <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: '600' }}>{e.customer}</Text>
            <Muted>
              {e.site.name}
              {e.vehicleRegNo ? ` · ${e.vehicleRegNo}` : ''}
            </Muted>
            <View style={styles.steps}>
              {e.steps.map((s) => (
                <Text key={`${s.kind}-${s.at}`} testID={`step-${e.fitmentId}-${s.kind}`} style={{ color: colors.foreground, fontSize: 14 }}>
                  {formatIstTime(s.at)} · {s.label}
                </Text>
              ))}
            </View>
          </View>
        );
        return (
          <Fragment key={e.fitmentId}>
            {e.legFromPreviousM !== null ? (
              <Muted style={styles.leg}>
                <Text testID={`leg-${e.fitmentId}`}>↓ {formatKm(e.legFromPreviousM)}</Text>
              </Muted>
            ) : null}
            {onOpen ? (
              <Pressable
                testID={`entry-${e.fitmentId}`}
                accessibilityRole="button"
                accessibilityLabel={`${e.tkId}, ${e.customer}`}
                onPress={() => onOpen(e)}
              >
                {card}
              </Pressable>
            ) : (
              <View testID={`entry-${e.fitmentId}`}>{card}</View>
            )}
          </Fragment>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 8 },
  totals: { fontSize: 18, fontWeight: '700', paddingBottom: 4 },
  card: { borderWidth: 1, padding: 14, gap: 4 },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  tk: { fontSize: 16, fontWeight: '700' },
  steps: { gap: 2, paddingTop: 4 },
  leg: { paddingLeft: 16 },
});
