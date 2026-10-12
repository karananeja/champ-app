import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/use-theme';

/** A modal card: the close dialogs, the location-required notice and the Continue-or-Close sheet. */
export function Dialog({
  visible,
  title,
  onClose,
  children,
  testID,
  sheet,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  testID?: string;
  /** Anchor to the bottom like an action sheet. */
  sheet?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Modal visible={visible} transparent animationType={sheet ? 'slide' : 'fade'} onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.backdrop, sheet && styles.sheetBackdrop]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
          <View testID={testID} style={[styles.card, sheet && styles.sheet, { backgroundColor: colors.card }]}>
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
              <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
                {title}
              </Text>
              {children}
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** A single-choice list (the close reasons). */
export function OptionList({
  options,
  value,
  onChange,
  testIDPrefix,
}: {
  options: { id: string; name: string }[];
  value: string | null;
  onChange: (id: string) => void;
  testIDPrefix: string;
}) {
  const { colors, radius } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {options.map((o) => {
        const selected = o.id === value;
        return (
          <Pressable
            key={o.id}
            testID={`${testIDPrefix}-${o.id}`}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(o.id)}
            style={[
              styles.option,
              { borderRadius: radius, borderColor: selected ? colors.primary : colors.border },
              selected && { backgroundColor: colors.brandSoft },
            ]}
          >
            <Text style={{ color: selected ? colors.brandSoftForeground : colors.foreground, fontSize: 16 }}>{o.name}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 20 },
  sheetBackdrop: { justifyContent: 'flex-end', padding: 0 },
  card: { borderRadius: 16, maxHeight: '90%' },
  sheet: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  content: { padding: 20, gap: 12 },
  title: { fontSize: 18, fontWeight: '700' },
  option: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 12 },
});
