import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { dateLabel, dateOptions } from '../lib/format';
import { useUnreadCount } from '../lib/notifications';
import { useSelectedDate } from '../lib/selected-date';
import { useTheme } from '../theme/use-theme';

/** M4 header: the date chip (today and the 7 days before it, D-029) and the notifications bell with the unread count (F13). */
export function AppHeader({ title }: { title: string }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { date, setDate } = useSelectedDate();
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const unread = useUnreadCount();

  return (
    <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: colors.background, borderColor: colors.border }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
        {title}
      </Text>
      <Pressable
        testID="date-chip"
        accessibilityRole="button"
        accessibilityLabel={`Date: ${dateLabel(date)}. Change date`}
        onPress={() => setOpen(true)}
        style={[styles.chip, { backgroundColor: colors.brandSoft }]}
      >
        <Text style={{ color: colors.brandSoftForeground, fontWeight: '600' }}>{dateLabel(date)} ▾</Text>
      </Pressable>
      <Pressable
        testID="bell"
        accessibilityRole="button"
        accessibilityLabel={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        onPress={() => router.push('/notifications')}
        style={styles.bell}
      >
        <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={colors.foreground} strokeWidth={2}>
          <Path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <Path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </Svg>
        {unread ? (
          <View testID="bell-badge" style={[styles.badge, { backgroundColor: colors.destructive }]}>
            <Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text>
          </View>
        ) : null}
      </Pressable>
      <DatePickerModal
        visible={open}
        value={date}
        onClose={() => setOpen(false)}
        onSelect={(d) => {
          setDate(d);
          setOpen(false);
        }}
      />
    </View>
  );
}

export function DatePickerModal({
  visible,
  value,
  onSelect,
  onClose,
}: {
  visible: boolean;
  value: string;
  onSelect: (day: string) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const options = dateOptions();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close date picker">
        <View style={[styles.sheet, { backgroundColor: colors.card }]}>
          <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Choose a date</Text>
          <FlatList
            data={options}
            keyExtractor={(o) => o.value}
            renderItem={({ item }) => {
              const selected = item.value === value;
              return (
                <Pressable
                  testID={`date-option-${item.value}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => onSelect(item.value)}
                  style={[styles.option, selected && { backgroundColor: colors.brandSoft }]}
                >
                  <Text style={{ color: selected ? colors.brandSoftForeground : colors.foreground, fontSize: 16 }}>
                    {item.label}
                  </Text>
                </Pressable>
              );
            }}
          />
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { flex: 1, fontSize: 20, fontWeight: '700' },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  bell: { padding: 6 },
  badge: { position: 'absolute', top: 0, right: 0, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#ffffff', fontSize: 10, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  sheet: { borderRadius: 14, paddingVertical: 12, maxHeight: '80%' },
  sheetTitle: { fontSize: 16, fontWeight: '600', paddingHorizontal: 16, paddingBottom: 8 },
  option: { paddingHorizontal: 16, paddingVertical: 12 },
});
