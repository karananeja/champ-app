/* Jest setup (F09): in-memory SecureStore, and stubs for the native map, location and router modules. */
import type * as ReactModule from 'react';
import type * as RNModule from 'react-native';

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    deleteItemAsync: jest.fn(async (k: string) => void store.delete(k)),
  };
});

jest.mock('@maplibre/maplibre-react-native', () => {
  const { View } = jest.requireActual<typeof RNModule>('react-native');
  const { forwardRef, createElement } = jest.requireActual<typeof ReactModule>('react');
  return {
    Map: ({ children }: { children?: unknown }) => createElement(View, { testID: 'map' }, children as never),
    Camera: forwardRef(() => null),
  };
});

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

jest.mock('expo-router', () => {
  const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
  return {
    __router: router,
    useRouter: () => router,
    useLocalSearchParams: jest.fn(() => ({})),
  };
});

jest.mock('react-native-svg', () => {
  const { View } = jest.requireActual<typeof RNModule>('react-native');
  const { createElement } = jest.requireActual<typeof ReactModule>('react');
  const Stub = (props: { testID?: string }) => createElement(View, { testID: props.testID });
  return { __esModule: true, default: Stub, Svg: Stub, Path: Stub, SvgXml: Stub };
});
