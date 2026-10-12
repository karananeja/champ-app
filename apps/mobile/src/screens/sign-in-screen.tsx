import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, MOBILE_ROLE_NOT_ALLOWED_MESSAGE, type LoginInput } from '@champ/shared';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Illustration } from '../components/illustration';
import { Button, Muted, TextField } from '../components/ui';
import { ApiError, isNetworkError } from '../lib/api-client';
import { useSession } from '../lib/session';
import { useTheme } from '../theme/use-theme';

/** M1: email and password, the same accounts as the web console. OT and OE only (D-128). */
export function SignInScreen() {
  const { colors } = useTheme();
  const { signIn } = useSession();
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await signIn(values);
    } catch (e) {
      if (e instanceof ApiError) {
        setFormError(e.code === 'MOBILE_ROLE_NOT_ALLOWED' ? MOBILE_ROLE_NOT_ALLOWED_MESSAGE : e.message);
      } else if (isNetworkError(e)) {
        setFormError("Can't reach the Champ server. Check your connection and try again.");
      } else {
        setFormError('Something went wrong. Try again.');
      }
    }
  });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Padding on Android too (CR-07, as D-177): with edge-to-edge the window doesn't resize for the keyboard. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <View style={[styles.logo, { backgroundColor: colors.primary }]}>
              <Text style={{ color: colors.primaryForeground, fontSize: 22, fontWeight: '800' }}>C</Text>
            </View>
            <Text style={[styles.brandName, { color: colors.foreground }]}>Champ</Text>
          </View>
          <Illustration name="login" height={140} />
          <View style={{ gap: 4 }}>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
              Sign in
            </Text>
            <Muted>Use your Champ email and password.</Muted>
          </View>
          <Controller
            control={control}
            name="email"
            render={({ field, fieldState }) => (
              <TextField
                label="Email"
                testID="email"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                textContentType="username"
                error={fieldState.error?.message}
              />
            )}
          />
          <Controller
            control={control}
            name="password"
            render={({ field, fieldState }) => (
              <TextField
                label="Password"
                testID="password"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                secureTextEntry={!showPassword}
                autoComplete="password"
                textContentType="password"
                error={fieldState.error?.message}
                right={
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                    onPress={() => setShowPassword((s) => !s)}
                    hitSlop={8}
                  >
                    <Text style={{ color: colors.primary, fontWeight: '600' }}>{showPassword ? 'Hide' : 'Show'}</Text>
                  </Pressable>
                }
              />
            )}
          />
          {formError ? (
            <Text accessibilityRole="alert" testID="form-error" style={{ color: colors.destructive }}>
              {formError}
            </Text>
          ) : null}
          <Button title="Sign in" testID="sign-in" onPress={onSubmit} loading={formState.isSubmitting} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 24, gap: 16, flexGrow: 1, justifyContent: 'center' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  brandName: { fontSize: 22, fontWeight: '700' },
  title: { fontSize: 24, fontWeight: '700' },
});
