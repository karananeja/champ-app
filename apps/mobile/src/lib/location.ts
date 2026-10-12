import * as Location from 'expo-location';

export interface Fix {
  lat: number;
  lng: number;
}

/** Rejects after `ms` so a GPS fix that never arrives doesn't hang the screen. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

export const ROUTE_FIX_TIMEOUT_MS = 10_000;
export const START_FIX_TIMEOUT_MS = 15_000;

/**
 * Best-effort fix for the route (F10 §5): balanced accuracy, 10 s. Denied permission, a timeout or any error
 * resolves null, and the route then starts from home.
 */
export async function tryRouteFix(): Promise<Fix | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const pos = await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      ROUTE_FIX_TIMEOUT_MS,
    );
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch {
    return null;
  }
}

export type RequiredFix = { ok: true; fix: Fix } | { ok: false; reason: 'denied' | 'unavailable' };

/** A fresh, high-accuracy fix for Start (M7): no home fallback. */
export async function requireFreshFix(): Promise<RequiredFix> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return { ok: false, reason: 'denied' };
  } catch {
    return { ok: false, reason: 'denied' };
  }
  try {
    const pos = await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      START_FIX_TIMEOUT_MS,
    );
    return { ok: true, fix: { lat: pos.coords.latitude, lng: pos.coords.longitude } };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
