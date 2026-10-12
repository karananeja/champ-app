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
    GeoJSONSource: ({ children }: { children?: unknown }) => createElement(View, { testID: 'route-line' }, children as never),
    Layer: () => null,
    Marker: ({ children }: { children?: unknown }) => children,
  };
});

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3, High: 4 },
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

jest.mock('expo-router', () => {
  const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), dismissTo: jest.fn(), canGoBack: jest.fn(() => true) };
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

/* F10B capture: camera, gallery, image manipulation, Skia stamping, temp files and text recognition. Each mock
   exposes its jest.fns (and the camera its last props, as `__camera`) so tests can drive them. */
jest.mock('expo-camera', () => {
  const { View } = jest.requireActual<typeof RNModule>('react-native');
  const { forwardRef, createElement, useImperativeHandle } = jest.requireActual<typeof ReactModule>('react');
  const camera = {
    permission: { granted: true, canAskAgain: true, status: 'granted' } as { granted: boolean; canAskAgain: boolean; status: string },
    requestPermission: jest.fn(async (): Promise<{ granted: boolean; canAskAgain: boolean; status: string }> => camera.permission),
    takePictureAsync: jest.fn(async () => ({ uri: 'file:///cache/camera.jpg', width: 4032, height: 3024 })),
    props: null as null | Record<string, unknown>,
  };
  const CameraView = forwardRef((props: Record<string, unknown>, ref) => {
    camera.props = props;
    useImperativeHandle(ref, () => ({ takePictureAsync: camera.takePictureAsync }));
    return createElement(View, { testID: props.testID as string });
  });
  return { __camera: camera, CameraView, useCameraPermissions: () => [camera.permission, camera.requestPermission] };
});

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: 'file:///gallery/pick.jpg', width: 3000, height: 4000 }] })),
}));

jest.mock('expo-image-manipulator', () => {
  const ref = (width: number, height: number) => ({
    width,
    height,
    saveAsync: jest.fn(async () => ({ uri: 'file:///cache/resized.jpg', width, height })),
  });
  const context = { resize: jest.fn(), renderAsync: jest.fn() };
  const manipulator = {
    __context: context,
    __ref: ref,
    manipulate: jest.fn(() => context),
  };
  context.resize.mockImplementation(() => context);
  context.renderAsync.mockImplementation(async () => ref(1600, 1200));
  return { ImageManipulator: manipulator, SaveFormat: { JPEG: 'jpeg', PNG: 'png' } };
});

jest.mock('@shopify/react-native-skia', () => {
  const canvas = { drawImage: jest.fn(), drawRect: jest.fn(), drawText: jest.fn() };
  const snapshot = { encodeToBytes: jest.fn(() => new Uint8Array([0xff, 0xd8, 0xff])) };
  const surface = { getCanvas: () => canvas, flush: jest.fn(), makeImageSnapshot: () => snapshot };
  const font = (size: number) => ({ getTextWidth: jest.fn((t: string) => t.length * size * 0.5), getSize: () => size });
  const skia = {
    __canvas: canvas,
    __snapshot: snapshot,
    Data: { fromURI: jest.fn(async (uri: string) => ({ uri })) },
    Image: { MakeImageFromEncoded: jest.fn(() => ({ width: () => 1600, height: () => 1200 })) },
    Surface: { Make: jest.fn(() => surface) },
    Paint: () => ({ setColor: jest.fn() }),
    Color: (c: string) => c,
    XYWHRect: (x: number, y: number, width: number, height: number) => ({ x, y, width, height }),
  };
  return {
    Skia: skia,
    ImageFormat: { JPEG: 3, PNG: 4, WEBP: 6 },
    matchFont: jest.fn((style: { fontSize: number }) => font(style.fontSize)),
  };
});

jest.mock('expo-file-system', () => {
  const files = new Set<string>();
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
    }
    get exists() {
      return files.has(this.uri);
    }
    create() {
      files.add(this.uri);
    }
    write() {
      files.add(this.uri);
    }
    delete() {
      files.delete(this.uri);
    }
  }
  return { __files: files, File, Paths: { cache: { uri: 'file:///cache' } } };
});

jest.mock('expo-text-extractor', () => ({
  isSupported: true,
  extractTextFromImage: jest.fn(async () => [] as string[]),
}));

/* F11 bulk fill: the CSV picker and the share sheet. */
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(async () => ({
    canceled: false,
    assets: [{ uri: 'file:///cache/fill.csv', name: 'fill.csv', mimeType: 'text/csv', size: 120 }],
  })),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}));
