import type { RouteLineString } from '@champ/shared';
import { SerialThrottle } from '../geocoder/throttle';
import { RouterUnavailableError, type LatLng, type RouteOptimizer, type RouteResult, type TripResult } from './types';

/** OSRM's trip service accepts at most 100 coordinates (the origin plus 99 stops). */
export const OSRM_MAX_STOPS = 99;
/** The route service's coordinate limit on the public server. */
export const OSRM_MAX_ROUTE_POINTS = 100;

export interface OsrmOptions {
  /** e.g. https://router.project-osrm.org (no trailing slash needed). */
  baseUrl: string;
  /** Injected in tests; defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Minimum gap between request starts (default 1000 ms). */
  minIntervalMs?: number;
  /** Per-request timeout (default 5000 ms). */
  timeoutMs?: number;
}

interface OsrmRouteResponse {
  code: string;
  routes?: { legs: { distance: number; duration: number }[] }[];
}

interface OsrmTripResponse {
  code: string;
  waypoints?: { waypoint_index: number; trips_index: number }[];
  trips?: { legs: { distance: number; duration: number }[]; geometry: RouteLineString }[];
}

/**
 * OSRM trip service: `/trip/v1/driving/{origin;stops}?source=first&roundtrip=false`. Requests are serialised
 * and spaced ≥1 s apart (the public demo server's policy) with a 5 s timeout. Any error, a non-Ok code
 * (e.g. `NoTrips`) or more than 99 stops throws `RouterUnavailableError`.
 */
export class OsrmRouter implements RouteOptimizer {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly throttle: SerialThrottle;

  constructor(options: OsrmOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.throttle = new SerialThrottle(options.minIntervalMs ?? 1000);
  }

  async trip(origin: LatLng, stops: LatLng[]): Promise<TripResult> {
    if (stops.length === 0) return { order: [], legs: [], geometry: null };
    if (stops.length > OSRM_MAX_STOPS) throw new RouterUnavailableError(`OSRM takes at most ${OSRM_MAX_STOPS} stops`);
    const coords = [origin, ...stops].map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
    const params = new URLSearchParams({ source: 'first', roundtrip: 'false', geometries: 'geojson', overview: 'full' });
    const body = (await this.request(`${this.baseUrl}/trip/v1/driving/${coords}?${params}`)) as OsrmTripResponse;
    return parseTrip(body, stops.length);
  }

  /** OSRM route service in the given order: `/route/v1/driving/{p1;p2;…}?overview=false`. */
  async route(points: LatLng[]): Promise<RouteResult> {
    if (points.length < 2) return { legs: [] };
    if (points.length > OSRM_MAX_ROUTE_POINTS) throw new RouterUnavailableError(`OSRM takes at most ${OSRM_MAX_ROUTE_POINTS} points`);
    const coords = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
    const body = (await this.request(`${this.baseUrl}/route/v1/driving/${coords}?overview=false`)) as OsrmRouteResponse;
    return parseRoute(body, points.length);
  }

  private request(url: string): Promise<unknown> {
    return this.throttle.run(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await this.fetchImpl(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
        // OSRM answers 400 with a JSON `code` (e.g. NoTrips, NoRoute); the parsers report it.
        if (!res.ok && res.status !== 400) throw new RouterUnavailableError(`OSRM responded ${res.status}`);
        return (await res.json()) as unknown;
      } catch (err) {
        if (err instanceof RouterUnavailableError) throw err;
        const reason = controller.signal.aborted ? 'timed out' : 'failed';
        throw new RouterUnavailableError(`OSRM request ${reason}`, { cause: err });
      } finally {
        clearTimeout(timer);
      }
    });
  }
}

/** Maps an OSRM trip response for `[origin, ...stops]` to the stop order, legs and geometry. */
export function parseTrip(body: OsrmTripResponse | null, stopCount: number): TripResult {
  if (!body || body.code !== 'Ok') throw new RouterUnavailableError(`OSRM returned ${body?.code ?? 'nothing'}`);
  const trip = body.trips?.[0];
  const waypoints = body.waypoints;
  if (!trip || !waypoints || waypoints.length !== stopCount + 1 || trip.legs.length !== stopCount) {
    throw new RouterUnavailableError('Unexpected OSRM trip response');
  }
  if (waypoints.some((w) => w.trips_index !== 0)) throw new RouterUnavailableError('OSRM split the trip');
  // waypoints[i] is input point i; waypoint_index is its position in the trip (the origin is 0).
  const order = waypoints
    .map((w, i) => ({ input: i - 1, position: w.waypoint_index }))
    .filter((w) => w.input >= 0)
    .sort((a, b) => a.position - b.position)
    .map((w) => w.input);
  return {
    order,
    legs: trip.legs.map((l) => ({ distanceM: Math.round(l.distance), durationS: Math.round(l.duration) })),
    geometry: trip.geometry?.type === 'LineString' ? trip.geometry : null,
  };
}

/** Maps an OSRM route response for `points` to one leg per consecutive pair. */
export function parseRoute(body: OsrmRouteResponse | null, pointCount: number): RouteResult {
  if (!body || body.code !== 'Ok') throw new RouterUnavailableError(`OSRM returned ${body?.code ?? 'nothing'}`);
  const route = body.routes?.[0];
  if (!route || route.legs.length !== pointCount - 1) throw new RouterUnavailableError('Unexpected OSRM route response');
  return { legs: route.legs.map((l) => ({ distanceM: Math.round(l.distance), durationS: Math.round(l.duration) })) };
}
