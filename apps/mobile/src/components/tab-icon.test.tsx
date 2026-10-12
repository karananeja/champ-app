import { render, screen } from '@testing-library/react-native';
import type * as ReactModule from 'react';
import AppLayout from '../app/(app)/_layout';

// CR-08: every bottom tab shows an icon above its label, tinted by the tab bar's active/inactive colour.
type Options = { title: string; tabBarIcon?: (p: { color: string; size: number; focused: boolean }) => ReactModule.ReactNode };
const screens: { name: string; options: Options }[] = [];
let screenOptions: Record<string, unknown> = {};

jest.mock('expo-router', () => {
  const { createElement, Fragment } = jest.requireActual<typeof ReactModule>('react');
  const Tabs = ({ children, screenOptions: so }: { children: ReactModule.ReactNode; screenOptions: Record<string, unknown> }) => {
    screenOptions = so;
    return createElement(Fragment, null, children);
  };
  Tabs.Screen = ({ name, options }: { name: string; options: Options }) => {
    screens.push({ name, options });
    return options.tabBarIcon ? options.tabBarIcon({ color: '#123456', size: 24, focused: name === 'home' }) : null;
  };
  return { Tabs };
});

describe('bottom tabs (CR-08)', () => {
  it('gives Home, Route, History and Profile an icon and no longer hides icons', async () => {
    screens.length = 0;
    await render(<AppLayout />);
    expect(screens.map((s) => s.name)).toEqual(['home', 'route', 'history', 'profile']);
    for (const name of ['home', 'route', 'history', 'profile']) expect(screen.getByTestId(`tab-icon-${name}`)).toBeOnTheScreen();
    expect(screenOptions.tabBarIconStyle).toBeUndefined();
  });
});
