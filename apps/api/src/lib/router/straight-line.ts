import type { LatLng, RouteResult, TripResult } from './types';

const EARTH_RADIUS_M = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The fallback order: nearest neighbour by straight-line distance from the origin, straight legs (rounded
 * metres), no durations and no geometry. Ties keep the input order.
 */
export function straightLineTrip(origin: LatLng, stops: LatLng[]): TripResult {
  const remaining = stops.map((_, i) => i);
  const order: number[] = [];
  const legs: TripResult['legs'] = [];
  let here = origin;
  while (remaining.length) {
    let best = 0;
    let bestD = Number.POSITIVE_INFINITY;
    remaining.forEach((idx, pos) => {
      const d = haversineM(here, stops[idx]!);
      if (d < bestD) {
        bestD = d;
        best = pos;
      }
    });
    const [idx] = remaining.splice(best, 1) as [number];
    order.push(idx);
    legs.push({ distanceM: Math.round(bestD), durationS: null });
    here = stops[idx]!;
  }
  return { order, legs, geometry: null };
}

/** Straight legs (rounded metres, no durations) between consecutive points in the given order. */
export function straightLineRoute(points: LatLng[]): RouteResult {
  return { legs: points.slice(1).map((p, i) => ({ distanceM: Math.round(haversineM(points[i]!, p)), durationS: null })) };
}
