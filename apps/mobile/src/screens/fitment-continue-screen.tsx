import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Illustration } from '../components/illustration';
import { Button, Muted } from '../components/ui';
import { useTheme } from '../theme/use-theme';

/** F10 placeholder for *Yes, continue*: the fitment form arrives in F10B. The fitment stays In progress. */
export function FitmentContinueScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View style={[styles.wrap, { backgroundColor: colors.background, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <Illustration name="tasks-empty" />
      <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
        Fitment form coming soon
      </Text>
      <Muted style={styles.message}>
        The fitment form (photos, checks and device details) arrives with the next update. This fitment stays In progress.
      </Muted>
      <Button title="Back to route" testID="back-to-route" onPress={() => router.dismissTo('/route')} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 24, gap: 12, justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '600', textAlign: 'center' },
  message: { textAlign: 'center' },
});
