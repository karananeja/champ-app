import type { FitmentStatus } from '@champ/shared';

/**
 * CR-03 / D-086 brand and light/dark tokens, ported from `apps/web/src/index.css` (oklch → sRGB hex). Indigo primary:
 * indigo-600 with white text in light, indigo-400 with indigo-950 text in dark.
 */
export interface Palette {
  background: string;
  foreground: string;
  card: string;
  primary: string;
  primaryForeground: string;
  muted: string;
  mutedForeground: string;
  border: string;
  input: string;
  destructive: string;
  brandSoft: string;
  brandSoftForeground: string;
  /** Illustration palette (unDraw colours remapped, as on web). */
  il: { accent: string; ink: string; inkSoft: string; paper: string; surface: string; surface2: string; line: string };
}

export const LIGHT: Palette = {
  background: '#ffffff',
  foreground: '#0a0a0a',
  card: '#ffffff',
  primary: '#4f39f6',
  primaryForeground: '#fafafa',
  muted: '#f5f5f5',
  mutedForeground: '#737373',
  border: '#e5e5e5',
  input: '#e5e5e5',
  destructive: '#e7000b',
  brandSoft: '#eef2ff',
  brandSoftForeground: '#432dd7',
  il: {
    accent: '#4f39f6',
    ink: '#101828',
    inkSoft: '#364153',
    paper: '#ffffff',
    surface: '#f3f4f6',
    surface2: '#e5e7eb',
    line: '#d1d5dc',
  },
};

export const DARK: Palette = {
  background: '#0a0a0a',
  foreground: '#fafafa',
  card: '#171717',
  primary: '#7c86ff',
  primaryForeground: '#1e1a4d',
  muted: '#262626',
  mutedForeground: '#a1a1a1',
  border: 'rgba(255,255,255,0.1)',
  input: 'rgba(255,255,255,0.15)',
  destructive: '#ff6467',
  brandSoft: '#1e1a4d',
  brandSoftForeground: '#c6d2ff',
  il: {
    accent: '#7c86ff',
    ink: '#2b3140',
    inkSoft: '#454c5c',
    paper: '#e5e5e5',
    surface: '#24272d',
    surface2: '#2d3036',
    line: '#5b5e66',
  },
};

/** One badge tone: border, background and text, light and dark (the web `TONES` in `apps/web/src/lib/tones.ts`). */
export interface Tone {
  border: string;
  bg: string;
  text: string;
}
type ToneName = 'amber' | 'sky' | 'violet' | 'blue' | 'teal' | 'emerald' | 'neutral' | 'red' | 'orange';

export const TONES: Record<ToneName, { light: Tone; dark: Tone }> = {
  amber: { light: { border: '#fee685', bg: '#fffbeb', text: '#973c00' }, dark: { border: '#7b3306', bg: '#461901', text: '#fee685' } },
  sky: { light: { border: '#b8e6fe', bg: '#f0f9ff', text: '#00598a' }, dark: { border: '#024a70', bg: '#052f4a', text: '#b8e6fe' } },
  violet: { light: { border: '#ddd6ff', bg: '#f5f3ff', text: '#5d0ec0' }, dark: { border: '#4d179a', bg: '#2f0d68', text: '#ddd6ff' } },
  blue: { light: { border: '#bedbff', bg: '#eff6ff', text: '#193cb8' }, dark: { border: '#1c398e', bg: '#162456', text: '#bedbff' } },
  teal: { light: { border: '#96f7e4', bg: '#f0fdfa', text: '#005f5a' }, dark: { border: '#0b4f4a', bg: '#022f2e', text: '#96f7e4' } },
  emerald: { light: { border: '#a4f4cf', bg: '#ecfdf5', text: '#007a55' }, dark: { border: '#004f3b', bg: '#002c22', text: '#a4f4cf' } },
  neutral: { light: { border: '#e5e5e5', bg: '#f5f5f5', text: '#525252' }, dark: { border: '#262626', bg: '#171717', text: '#d4d4d4' } },
  red: { light: { border: '#ffc9c9', bg: '#fef2f2', text: '#c10007' }, dark: { border: '#82181a', bg: '#460809', text: '#ffc9c9' } },
  orange: { light: { border: '#ffd6a7', bg: '#fff7ed', text: '#9f2d00' }, dark: { border: '#7e2a0c', bg: '#441306', text: '#ffd6a7' } },
};

/** Same status → tone map as the web badges (F05). */
export const STATUS_TONE: Record<FitmentStatus, ToneName> = {
  OPEN: 'amber',
  ASSIGNED: 'sky',
  IN_PROGRESS: 'violet',
  SUBMITTED: 'blue',
  OE_VERIFIED: 'teal',
  OM_APPROVED: 'emerald',
  CLOSED_NOT_DONE: 'neutral',
  MOVED_TO_FT: 'red',
  REOPENED: 'orange',
};
