import { FITMENT_STATUS_LABELS, type FitmentStatus } from '@champ/shared';
import { StyleSheet, Text, View } from 'react-native';
import { STATUS_TONE, TONES } from '../theme/colors';
import { useTheme } from '../theme/use-theme';

/** Fitment status badge in the web colours (F05 / CR-03). */
export function StatusBadge({ status }: { status: FitmentStatus }) {
  const { dark } = useTheme();
  const tone = TONES[STATUS_TONE[status]][dark ? 'dark' : 'light'];
  return (
    <View testID={`status-${status}`} style={[styles.badge, { backgroundColor: tone.bg, borderColor: tone.border }]}>
      <Text style={[styles.text, { color: tone.text }]}>{FITMENT_STATUS_LABELS[status]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  text: { fontSize: 12, fontWeight: '600' },
});
