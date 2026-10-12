import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';
import { Appearance } from 'react-native';

/** CR-09: the user's theme choice; "system" follows the phone setting (CR-03). Remembered on the device. */
export type ThemePreference = 'system' | 'light' | 'dark';
export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];
const KEY = 'champ.theme';

let preference: ThemePreference = 'system';
const listeners = new Set<() => void>();

/** Also overrides the app's native appearance (pickers, alerts, keyboard) so everything matches the choice. */
function apply() {
  try {
    Appearance.setColorScheme?.(preference === 'system' ? 'unspecified' : preference);
  } catch {
    // Not available (tests): the palette still follows the choice through useTheme.
  }
  listeners.forEach((l) => l());
}

/** Loads the saved choice once at startup (the root layout calls it). */
export async function loadThemePreference(): Promise<void> {
  try {
    const stored = await SecureStore.getItemAsync(KEY);
    if (stored === 'light' || stored === 'dark') {
      preference = stored;
      apply();
    }
  } catch {
    // Unreadable storage: keep following the system.
  }
}

export function setThemePreference(next: ThemePreference): void {
  preference = next;
  apply();
  void (next === 'system' ? SecureStore.deleteItemAsync(KEY) : SecureStore.setItemAsync(KEY, next)).catch(() => undefined);
}

const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
};

export const useThemePreference = (): ThemePreference => useSyncExternalStore(subscribe, () => preference);
