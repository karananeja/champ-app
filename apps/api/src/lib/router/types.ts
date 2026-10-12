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

/** Route optimiser (D-015). OSRM by default; tests inject an in-memory stub. */
export interface RouteOptimizer {
  /** Throws `RouterUnavailableError` on any failure; the caller falls back to straight lines. */
  trip(origin: LatLng, stops: LatLng[]): Promise<TripResult>;
}

/** The provider failed, timed out, found no trip or got too many stops. */
export class RouterUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RouterUnavailableError';
  }
}
