import { useColorScheme } from 'react-native';
import { DARK, LIGHT, type Palette } from './colors';
import { useThemePreference } from './theme-preference';

export interface Theme {
  dark: boolean;
  colors: Palette;
  radius: number;
}

/** The palette for the chosen theme (CR-09), or the system light/dark setting when it's "System" (CR-03). */
export function useTheme(): Theme {
  const preference = useThemePreference();
  const system = useColorScheme();
  const dark = preference === 'system' ? system === 'dark' : preference === 'dark';
  return { dark, colors: dark ? DARK : LIGHT, radius: 10 };
}
