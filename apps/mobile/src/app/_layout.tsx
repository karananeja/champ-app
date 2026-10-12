import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NoConnection } from '../components/state-view';
import { ToastProvider } from '../components/toast';
import { createQueryClient } from '../lib/query-client';
import { SelectedDateProvider } from '../lib/selected-date';
import { SessionProvider, useSession } from '../lib/session';
import { useTheme } from '../theme/use-theme';

let showToast: (message: string) => void = () => {};

export default function RootLayout() {
  const [queryClient] = useState(() => createQueryClient((m) => showToast(m)));
  return (
    <SafeAreaProvider>
      <ToastProvider bindShow={(fn) => (showToast = fn)}>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            <SelectedDateProvider>
              <RootNavigator />
            </SelectedDateProvider>
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
