import * as SecureStore from 'expo-secure-store';

/** The refresh token lives in the platform keychain/keystore (D-133); the access token only in memory. */
const KEY = 'champ.refreshToken';

export const tokenStore = {
  get: (): Promise<string | null> => SecureStore.getItemAsync(KEY),
  set: (token: string): Promise<void> => SecureStore.setItemAsync(KEY, token),
  clear: (): Promise<void> => SecureStore.deleteItemAsync(KEY),
};
