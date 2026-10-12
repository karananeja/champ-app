import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../theme/use-theme';

/**
 * A drawn checkbox (CR-09): an outlined box, filled with the primary colour and a tick when checked. Replaces the
 * ☑/☐ text glyphs, which were hard to tell apart in dark mode.
 */
export function CheckBox({ checked, testID }: { checked: boolean; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View
      testID={testID}
      style={{
        width: 22,
        height: 22,
        borderRadius: 5,
        borderWidth: 2,
        borderColor: checked ? colors.primary : colors.mutedForeground,
        backgroundColor: checked ? colors.primary : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {checked ? (
        <Svg testID={testID ? `${testID}-tick` : undefined} width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={colors.primaryForeground} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
          <Path d="M20 6 9 17l-5-5" />
        </Svg>
      ) : null}
    </View>
  );
}
