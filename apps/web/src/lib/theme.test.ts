import { afterEach, describe, expect, it } from 'vitest';
import { THEME_STORAGE_KEY, isDark, setThemePreference } from './theme';

// CR-09: the theme choice drives the .dark class and is remembered; "system" follows the OS.
describe('theme preference', () => {
  afterEach(() => setThemePreference('system'));

  it('dark and light set the class and are stored; system clears the stored choice', () => {
    setThemePreference('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    setThemePreference('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    setThemePreference('system');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('system follows the OS setting', () => {
    expect(isDark('dark')).toBe(true);
    expect(isDark('light')).toBe(false);
    expect(isDark('system')).toBe(window.matchMedia('(prefers-color-scheme: dark)').matches);
  });
});
