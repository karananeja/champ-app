import type { RouteLineString } from '@champ/shared';

export interface LatLng {
  lat: number;
  lng: number;
}

/** A computed visiting order from an origin through every stop (no return). */
export interface TripResult {
  /** Indexes into the `stops` passed in, in visiting order. */
  order: number[];
  /** One leg per stop in visiting order: from the previous point (the origin for the first). */
  legs: { distanceM: number; durationS: number | null }[];
  geometry: RouteLineString | null;
}

/** Driving legs between consecutive points, in the given order. */
export interface RouteResult {
  /** One leg per consecutive pair (`points.length - 1`). */
  legs: { distanceM: number; durationS: number | null }[];
}

/** Route optimiser (D-015). OSRM by default; tests inject an in-memory stub. */
export interface RouteOptimizer {
  /** Throws `RouterUnavailableError` on any failure; the caller falls back to straight lines. */
  trip(origin: LatLng, stops: LatLng[]): Promise<TripResult>;
  /** Legs through `points` in the fixed order (F12 day distance). Throws `RouterUnavailableError` like `trip`. */
  route(points: LatLng[]): Promise<RouteResult>;
}

/** The provider failed, timed out, found no trip or got too many stops. */
export class RouterUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RouterUnavailableError';
  }
}
