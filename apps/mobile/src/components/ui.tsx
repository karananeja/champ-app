import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from '../theme/use-theme';

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  testID,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
}) {
  const { colors, radius } = useTheme();
  const bg =
    variant === 'primary' ? colors.primary : variant === 'destructive' ? colors.destructive : variant === 'secondary' ? colors.muted : 'transparent';
  const fg = variant === 'primary' ? colors.primaryForeground : variant === 'destructive' ? '#ffffff' : colors.foreground;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || !!loading, busy: !!loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, borderRadius: radius, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        variant === 'ghost' && { borderWidth: 1, borderColor: colors.border },
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function TextField({
  label,
  error,
  right,
  ...props
}: TextInputProps & { label: string; error?: string; right?: ReactNode }) {
  const { colors, radius } = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
      <View style={[styles.inputRow, { borderColor: error ? colors.destructive : colors.input, borderRadius: radius }]}>
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={colors.mutedForeground}
          style={[styles.input, { color: colors.foreground }]}
          {...props}
        />
        {right}
      </View>
      {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
    </View>
  );
}

export function Card({ children, testID }: { children: ReactNode; testID?: string }) {
  const { colors, radius } = useTheme();
  return (
    <View testID={testID} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius + 4 }]}>
      {children}
    </View>
  );
}

export function Muted({ children, style }: { children: ReactNode; style?: object }) {
  const { colors } = useTheme();
  return <Text style={[{ color: colors.mutedForeground, fontSize: 14 }, style]}>{children}</Text>;
}

const styles = StyleSheet.create({
  button: { minHeight: 48, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 16, fontWeight: '600' },
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '500' },
  inputRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, minHeight: 48, paddingHorizontal: 12 },
  input: { flex: 1, fontSize: 16, paddingVertical: 10 },
  error: { fontSize: 13 },
  card: { borderWidth: 1, padding: 16, gap: 6 },
});
