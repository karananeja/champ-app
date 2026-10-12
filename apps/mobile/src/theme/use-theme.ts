import { useColorScheme } from 'react-native';
import { DARK, LIGHT, type Palette } from './colors';

export interface Theme {
  dark: boolean;
  colors: Palette;
  radius: number;
}

/** The system light/dark setting picks the palette (CR-03); the font is the system font. */
export function useTheme(): Theme {
  const dark = useColorScheme() === 'dark';
  return { dark, colors: dark ? DARK : LIGHT, radius: 10 };
}
