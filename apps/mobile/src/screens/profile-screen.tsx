import { ROLE_LABELS } from '@champ/shared';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, Muted } from '../components/ui';
import { formatDay } from '../lib/format';
import { useSession } from '../lib/session';
import { useTheme } from '../theme/use-theme';

/** M17: read-only profile, home location with Change, app version and Sign out. */
export function ProfileScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { user, signOut } = useSession();
  const [signingOut, setSigningOut] = useState(false);
  if (!user) return null;

  const home = user.homeLocation;
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={[styles.name, { color: colors.foreground }]}>
          {user.name}
        </Text>
        <Card>
          <Field label="Email" value={user.email} />
          <Field label="Role" value={ROLE_LABELS[user.role]} />
          <Field label="Job title" value={user.jobTitle ?? '—'} />
          <Field label="Phone" value={user.phone ?? '—'} />
        </Card>
        <Card>
          <Field label="Manager" value={user.manager?.name ?? '—'} />
          {user.manager?.phone ? (
            <Pressable
              testID="manager-phone"
              accessibilityRole="link"
              accessibilityLabel={`Call ${user.manager.name}`}
              onPress={() => void Linking.openURL(`tel:${user.manager?.phone}`)}
            >
              <Muted>Manager phone</Muted>
              <Text style={{ color: colors.primary, fontSize: 16, fontWeight: '600' }}>{user.manager.phone}</Text>
            </Pressable>
          ) : (
            <Field label="Manager phone" value="—" />
          )}
        </Card>
        <Card testID="home-location">
          <Muted>Home location</Muted>
          {home ? (
            <>
              <Text style={{ color: colors.foreground, fontSize: 16 }}>{home.address}</Text>
              <Muted>Updated {formatDay(home.updatedAt.slice(0, 10))}</Muted>
            </>
          ) : (
            <Text style={{ color: colors.foreground, fontSize: 16 }}>Not set</Text>
          )}
          <Button
            title="Change"
            variant="ghost"
            testID="change-home"
            onPress={() => router.push({ pathname: '/onboarding/home-location', params: { mode: 'edit' } })}
          />
        </Card>
        <Muted style={styles.version}>{`Champ v${Constants.expoConfig?.version ?? 'dev'}`}</Muted>
        <Button
          title="Sign out"
          variant="secondary"
          testID="sign-out"
          loading={signingOut}
          onPress={() => {
            setSigningOut(true);
            void signOut();
          }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 2 }}>
      <Muted>{label}</Muted>
      <Text style={{ color: colors.foreground, fontSize: 16 }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  name: { fontSize: 24, fontWeight: '700' },
  version: { textAlign: 'center' },
});
