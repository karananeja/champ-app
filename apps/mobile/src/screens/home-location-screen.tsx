import {
  setHomeLocationSchema,
  type GeoReverseResponse,
  type GeoSearchResponse,
  type SetHomeLocationInput,
  type UserDto,
} from '@champ/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LocationMap, type LngLatTarget } from '../components/location-map';
import { Button, Muted, TextField } from '../components/ui';
import { ApiError, api, isNetworkError } from '../lib/api-client';
import { useSession } from '../lib/session';
import { useTheme } from '../theme/use-theme';

/** Centre of India, until the user has a home location or uses GPS/search. */
const DEFAULT_CENTER = { lng: 78.9629, lat: 20.5937, zoom: 4 };
export const DEBOUNCE_MS = 400;

export const PERMISSION_DENIED_MESSAGE =
  'Location permission is off. To use your current location, allow location access for Champ in Settings, or search an address instead.';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** M2 / D-129: GPS, address search or the map pin. OT must save; OE may skip. `mode=edit` comes from the profile. */
export function HomeLocationScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const editing = mode === 'edit';
  const { user, setUser, skipHomeLocation } = useSession();
  const existing = user?.homeLocation ?? null;

  const [center, setCenter] = useState(existing ? { lng: existing.lng, lat: existing.lat } : null);
  const [target, setTarget] = useState<LngLatTarget | null>(null);
  // Typed or picked from search; otherwise the pin's reverse-geocoded address.
  const [typedAddress, setTypedAddress] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const debouncedSearch = useDebounced(search.trim(), DEBOUNCE_MS);
  const debouncedCenter = useDebounced(center, DEBOUNCE_MS);

  const results = useQuery({
    queryKey: ['geo-search', debouncedSearch],
    queryFn: () => api<GeoSearchResponse>('/geo/search', { query: { q: debouncedSearch } }),
    enabled: debouncedSearch.length >= 3,
  });

  // The pin's address: reverse-geocode wherever the map settles.
  const reverseKey = debouncedCenter ? [debouncedCenter.lat.toFixed(5), debouncedCenter.lng.toFixed(5)] : null;
  const reverse = useQuery({
    queryKey: ['geo-reverse', ...(reverseKey ?? [])],
    queryFn: () => api<GeoReverseResponse>('/geo/reverse', { query: { lat: reverseKey?.[0], lng: reverseKey?.[1] } }),
    enabled: !!reverseKey && !(existing && reverseKey[0] === existing.lat.toFixed(5) && reverseKey[1] === existing.lng.toFixed(5)),
  });
  const address = typedAddress ?? reverse.data?.item?.displayName ?? existing?.address ?? '';
  const pinMoved = (lng: number, lat: number) => {
    setCenter({ lng, lat });
    setTypedAddress(null);
  };

  const moveTo = (lng: number, lat: number) => {
    pinMoved(lng, lat);
    setTarget((t) => ({ lng, lat, seq: (t?.seq ?? 0) + 1 }));
  };

  const locateMe = async () => {
    setPermissionMessage(null);
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setPermissionMessage(PERMISSION_DENIED_MESSAGE);
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      moveTo(pos.coords.longitude, pos.coords.latitude);
    } catch {
      setPermissionMessage("Couldn't get your location. Try again, or search an address.");
    } finally {
      setLocating(false);
    }
  };

  const save = useMutation({
    mutationFn: (body: SetHomeLocationInput) => api<UserDto>('/me/home-location', { method: 'PUT', body }),
    onSuccess: (u) => {
      setUser(u);
      if (editing && router.canGoBack()) router.back();
      else router.replace('/home');
    },
    onError: (e) => {
      setError(
        isNetworkError(e) ? "Can't reach the Champ server. Try again." : e instanceof ApiError ? e.message : 'Could not save.',
      );
    },
  });

  const onSave = () => {
    setError(null);
    if (!center) {
      setError('Move the map, use your current location or search an address first.');
      return;
    }
    const parsed = setHomeLocationSchema.safeParse({ lat: center.lat, lng: center.lng, address });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the address');
      return;
    }
    save.mutate(parsed.data);
  };

  const canSkip = !editing && user?.role === 'OE';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
            {editing ? 'Change home location' : 'Set your home location'}
          </Text>
          <Muted>Your home is the starting point for your daily route when you have no other location.</Muted>

          <TextField
            label="Search an address"
            testID="address-search"
            value={search}
            onChangeText={setSearch}
            placeholder="Area, street or landmark"
            autoCorrect={false}
          />
          {debouncedSearch.length >= 3 && results.data
            ? results.data.items.map((r) => (
                <Pressable
                  key={`${r.lat},${r.lng}`}
                  accessibilityRole="button"
                  onPress={() => {
                    moveTo(r.lng, r.lat);
                    setTypedAddress(r.displayName);
                    setSearch('');
                  }}
                  style={[styles.result, { borderColor: colors.border }]}
                >
                  <Text style={{ color: colors.foreground }}>{r.displayName}</Text>
                </Pressable>
              ))
            : null}

          <Button title="Use my current location" variant="ghost" testID="use-gps" loading={locating} onPress={() => void locateMe()} />
          {permissionMessage ? (
            <View style={{ gap: 6 }}>
              <Text testID="permission-message" style={{ color: colors.destructive }}>
                {permissionMessage}
              </Text>
              <Pressable accessibilityRole="link" onPress={() => void Linking.openSettings()}>
                <Text style={{ color: colors.primary, fontWeight: '600' }}>Open Settings</Text>
              </Pressable>
            </View>
          ) : null}

          <LocationMap
            initial={existing ? { lng: existing.lng, lat: existing.lat, zoom: 15 } : DEFAULT_CENTER}
            target={target}
            onCenterChange={pinMoved}
          />

          <TextField
            label="Address"
            testID="address"
            value={address}
            onChangeText={setTypedAddress}
            multiline
            placeholder="The pin's address appears here"
          />
          {error ? (
            <Text accessibilityRole="alert" testID="save-error" style={{ color: colors.destructive }}>
              {error}
            </Text>
          ) : null}
          <Button title="Save" testID="save" loading={save.isPending} onPress={onSave} />
          {canSkip ? (
            <Button
              title="Skip"
              variant="ghost"
              testID="skip"
              onPress={() => {
                skipHomeLocation();
                router.replace('/home');
              }}
            />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: '700' },
  result: { borderWidth: 1, borderRadius: 10, padding: 12 },
});
