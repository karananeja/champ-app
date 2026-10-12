import { useSyncExternalStore } from 'react';

/** CR-09: the user's theme choice; "system" follows the OS setting (CR-03). Remembered per browser. */
export type ThemePreference = 'system' | 'light' | 'dark';
export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];
/** Also read by the inline script in `index.html`, so the first paint already has the right theme. */
export const THEME_STORAGE_KEY = 'champ-theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';
const listeners = new Set<() => void>();

function readPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

let preference: ThemePreference = typeof window === 'undefined' ? 'system' : readPreference();

const systemDark = () => typeof window !== 'undefined' && !!window.matchMedia?.(DARK_QUERY).matches;
export const isDark = (pref: ThemePreference): boolean => pref === 'dark' || (pref === 'system' && systemDark());

/** Puts the `.dark` class on <html> for the current choice (the tokens in index.css follow it). */
function apply() {
  document.documentElement.classList.toggle('dark', isDark(preference));
  listeners.forEach((l) => l());
}

export function setThemePreference(next: ThemePreference) {
  preference = next;
  try {
    if (next === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Private mode or blocked storage: the choice lasts for this page only.
  }
  apply();
}

// An OS change matters only while following the system.
if (typeof window !== 'undefined' && window.matchMedia) {
  window.matchMedia(DARK_QUERY).addEventListener?.('change', () => {
    if (preference === 'system') apply();
  });
}

const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
};

/** The chosen preference and whether the page is dark right now. */
export function useTheme(): { preference: ThemePreference; dark: boolean } {
  const pref = useSyncExternalStore(subscribe, () => preference, () => 'system' as ThemePreference);
  const dark = useSyncExternalStore(subscribe, () => isDark(preference), () => false);
  return { preference: pref, dark };
}
