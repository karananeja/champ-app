import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NoConnection } from '../components/state-view';
import { ToastProvider } from '../components/toast';
import { NotificationsProvider } from '../lib/notifications';
import { createQueryClient } from '../lib/query-client';
import { SelectedDateProvider } from '../lib/selected-date';
import { SessionProvider, useSession } from '../lib/session';
import { loadThemePreference } from '../theme/theme-preference';
import { useTheme } from '../theme/use-theme';

let showToast: (message: string) => void = () => {};

// CR-09: apply the saved theme choice as early as possible.
void loadThemePreference();

export default function RootLayout() {
  const [queryClient] = useState(() => createQueryClient((m) => showToast(m)));
  return (
    <SafeAreaProvider>
      <ToastProvider bindShow={(fn) => (showToast = fn)}>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            <NotificationsProvider>
              <SelectedDateProvider>
                <RootNavigator />
              </SelectedDateProvider>
            </NotificationsProvider>
          </SessionProvider>
        </QueryClientProvider>
      </ToastProvider>
    </SafeAreaProvider>
  );
}

/** Route guards: signed out → sign-in; OT without a home location → onboarding (D-129); otherwise the app. */
function RootNavigator() {
  const { colors, dark } = useTheme();
  const { status, needsHomeLocation, restore } = useSession();
  const signedIn = status === 'signed-in';
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Protected guard={signedIn && !needsHomeLocation}>
          <Stack.Screen name="(app)" />
          <Stack.Screen name="fitment/[id]/index" />
          <Stack.Screen name="fitment/[id]/continue" />
          <Stack.Screen name="fitment/[id]/summary" />
          <Stack.Screen name="task/[id]/bulk-fill" />
          <Stack.Screen name="task/[id]/photos" />
          <Stack.Screen name="history/[id]" />
          <Stack.Screen name="approve-visit/index" />
          <Stack.Screen name="approve-visit/[id]" />
          <Stack.Screen name="notifications" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="onboarding/home-location" options={{ gestureEnabled: false }} />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
      </Stack>
      {status === 'loading' ? (
        <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: colors.background }]}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : null}
      {status === 'offline' ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]}>
          <NoConnection onRetry={() => void restore()} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ center: { alignItems: 'center', justifyContent: 'center' } });
