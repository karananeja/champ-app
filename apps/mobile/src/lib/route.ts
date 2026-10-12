import type { DayRouteDto, MyFitmentDto } from '@champ/shared';
import { Platform } from 'react-native';

export const routeQueryKey = (date: string) => ['mobile-route', date] as const;
export const fitmentQueryKey = (id: string) => ['mobile-fitment', id] as const;

/** "3.4 km · 12 min from previous"; distance only when the router gave no duration (straight-line fallback). */
export function formatLeg(leg: { distanceM: number; durationS: number | null }): string {
  const km = `${(leg.distanceM / 1000).toFixed(1)} km`;
  if (leg.durationS === null) return `${km} from previous`;
  return `${km} · ${Math.max(1, Math.round(leg.durationS / 60))} min from previous`;
}

export const formatKm = (m: number): string => `${(m / 1000).toFixed(1)} km`;

type LngLat = [number, number];

const sitePoint = (f: MyFitmentDto): LngLat | null =>
  f.site.lat !== null && f.site.lng !== null ? [f.site.lng, f.site.lat] : null;

/**
 * The line to draw: the router's geometry, else straight segments from the origin through the open stops in
 * route order (done stops are already behind the technician).
 */
export function routeLine(route: DayRouteDto): LngLat[] {
  if (route.geometry && route.geometry.coordinates.length >= 2) {
    return route.geometry.coordinates.map((c) => [c[0] as number, c[1] as number]);
  }
  const pts: LngLat[] = [];
  if (route.origin) pts.push([route.origin.lng, route.origin.lat]);
  for (const s of route.stops) {
    if (s.done) continue;
    const p = sitePoint(s.fitment);
    if (p) pts.push(p);
  }
  return pts;
}

/** [west, south, east, north] around every stop and the origin, or null with no coordinates. */
export function routeBounds(route: DayRouteDto): [number, number, number, number] | null {
  const pts: LngLat[] = route.stops.map((s) => sitePoint(s.fitment)).filter((p): p is LngLat => p !== null);
  if (route.origin) pts.push([route.origin.lng, route.origin.lat]);
  if (pts.length === 0) return null;
  const lngs = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  // A single point still needs a small box to zoom to.
  const pad = pts.length === 1 ? 0.01 : 0;
  return [Math.min(...lngs) - pad, Math.min(...lats) - pad, Math.max(...lngs) + pad, Math.max(...lats) + pad];
}

/**
 * Directions in the phone's maps app (F10 §5): Apple Maps on iOS; Google Maps navigation on Android, falling back
 * to a `geo:` intent any maps app can take.
 */
export function directionsUrls(lat: number, lng: number, label: string, os: string = Platform.OS): string[] {
  if (os === 'ios') return [`http://maps.apple.com/?daddr=${lat},${lng}`];
  return [`google.navigation:q=${lat},${lng}`, `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(label)})`];
}
