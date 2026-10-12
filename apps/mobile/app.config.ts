import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Champ field app (F09, D-130/D-133). A development build, not Expo Go. `ios/` and `android/` are generated from
 * this file (CNG) and are not committed. `APP_VARIANT=production` builds `in.intellicar.champ`; everything else is
 * the dev variant `in.intellicar.champ.dev`, so both can sit side by side on one phone.
 */
const IS_PROD = process.env.APP_VARIANT === 'production';
const BUNDLE_ID = IS_PROD ? 'in.intellicar.champ' : 'in.intellicar.champ.dev';

const LOCATION_PERMISSION =
  'Champ uses your location to plan your daily route, record where you start each fitment and set your home location.';
// F10B: fitment photos and device-id scanning.
const CAMERA_PERMISSION = 'Champ uses the camera to take fitment photos and scan device ids.';
const PHOTOS_PERMISSION = 'Champ lets you choose fitment photos from your gallery.';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: IS_PROD ? 'Champ' : 'Champ Dev',
  slug: 'champ',
  version: '0.1.0',
  scheme: IS_PROD ? 'champ' : 'champ-dev',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: BUNDLE_ID,
    supportsTablet: false,
    infoPlist: {
      // The API runs over plain HTTP on the Mac (localhost or its LAN IP) during development.
      NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
    },
  },
  android: {
    package: BUNDLE_ID,
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-dev-client',
    [
      'expo-location',
      {
        locationWhenInUsePermission: LOCATION_PERMISSION,
        isIosBackgroundLocationEnabled: false,
        isAndroidBackgroundLocationEnabled: false,
      },
    ],
    '@maplibre/maplibre-react-native',
    [
      'expo-camera',
      { cameraPermission: CAMERA_PERMISSION, microphonePermission: false, recordAudioAndroid: false, barcodeScannerEnabled: true },
    ],
    [
      'expo-image-picker',
      { photosPermission: PHOTOS_PERMISSION, cameraPermission: CAMERA_PERMISSION, microphonePermission: false },
    ],
  ],
  experiments: { typedRoutes: true },
});
