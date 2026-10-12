import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import { TabIcon, type TabIconName } from '../../components/tab-icon';
import { useTheme } from '../../theme/use-theme';

/** Bottom-tab icon for a screen (CR-08); the tint follows the active/inactive colours. */
const icon =
  (name: TabIconName) =>
  ({ color, size, focused }: { color: ColorValue; size: number; focused: boolean }) => <TabIcon name={name} color={color} size={size} focused={focused} />;

export default function AppLayout() {
  const { colors } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: { backgroundColor: colors.background, borderTopColor: colors.border },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="home" options={{ title: 'Home', tabBarIcon: icon('home') }} />
      <Tabs.Screen name="route" options={{ title: 'Route', tabBarIcon: icon('route') }} />
      <Tabs.Screen name="history" options={{ title: 'History', tabBarIcon: icon('history') }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('profile') }} />
    </Tabs>
  );
}
