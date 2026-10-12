import type { ColorValue } from 'react-native';
import Svg, { Path } from 'react-native-svg';

/** Outline icons for the bottom tabs (CR-08), drawn like the header bell (24 × 24 grid, round strokes). */
const PATHS = {
  home: [
    'M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8',
    'M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  ],
  route: ['M3 19a3 3 0 1 0 6 0a3 3 0 1 0-6 0', 'M15 5a3 3 0 1 0 6 0a3 3 0 1 0-6 0', 'M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15'],
  history: ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5', 'M12 7v5l4 2'],
  profile: ['M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2', 'M8 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0'],
} as const;

export type TabIconName = keyof typeof PATHS;

export function TabIcon({ name, color, size = 24, focused = false }: { name: TabIconName; color: ColorValue; size?: number; focused?: boolean }) {
  return (
    <Svg
      testID={`tab-icon-${name}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={focused ? 2.4 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name].map((d) => (
        <Path key={d} d={d} />
      ))}
    </Svg>
  );
}
