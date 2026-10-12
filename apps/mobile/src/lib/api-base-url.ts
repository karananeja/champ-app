import Constants from 'expo-constants';
import { Platform } from 'react-native';

export const API_PORT = 4000;

/**
 * The API origin (D-133). `EXPO_PUBLIC_API_URL` wins (e.g. `http://192.168.1.20:4000`); otherwise the host Metro
 * is served from, port 4000, so the simulator, the emulator and a phone on the same Wi-Fi all reach the Mac. On the
 * Android emulator `localhost` is the emulator itself, so it becomes `10.0.2.2`.
 */
export function resolveApiOrigin(
  envUrl: string | undefined = process.env.EXPO_PUBLIC_API_URL,
  hostUri: string | undefined = Constants.expoConfig?.hostUri,
  os: string = Platform.OS,
): string {
  if (envUrl && envUrl.trim()) return envUrl.trim().replace(/\/+$/, '');
  let host = hostUri?.split(':')[0]?.trim() || 'localhost';
  if (os === 'android' && (host === 'localhost' || host === '127.0.0.1')) host = '10.0.2.2';
  return `http://${host}:${API_PORT}`;
}
