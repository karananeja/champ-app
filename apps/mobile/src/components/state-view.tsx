import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/use-theme';
import { Illustration, type IllustrationName } from './illustration';
import { Button, Muted } from './ui';

/** Empty, error and no-connection states: an illustration, a title, a line and an optional action. */
export function StateView({
  illustration,
  title,
  message,
  actionLabel,
  onAction,
}: {
  illustration: IllustrationName;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap}>
      <Illustration name={illustration} />
      <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
        {title}
      </Text>
      {message ? <Muted style={styles.message}>{message}</Muted> : null}
      {actionLabel && onAction ? <Button title={actionLabel} onPress={onAction} /> : null}
    </View>
  );
}

/** D-008: online only. Shown whenever the API can't be reached. */
export function NoConnection({ onRetry }: { onRetry: () => void }) {
  return (
    <StateView
      illustration="offline"
      title="No connection"
      message="Champ can't reach the server. Check your internet connection and try again."
      actionLabel="Retry"
      onAction={onRetry}
    />
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'stretch', justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 20, fontWeight: '600', textAlign: 'center' },
  message: { textAlign: 'center' },
});
