import type { GeoResult } from '@champ/shared';

export type { GeoResult };

export interface GeoSearchOptions {
  /** Maximum number of results (default 5). */
  limit?: number;
}

/** Geocoding provider (D-054). Nominatim by default; can be swapped for a self-hosted one later. */
export interface Geocoder {
  search(q: string, opts?: GeoSearchOptions): Promise<GeoResult[]>;
  reverse(lat: number, lng: number): Promise<GeoResult | null>;
}

/** The provider failed, timed out or returned an unusable response. Mapped to 503 GEOCODER_UNAVAILABLE. */
export class GeocoderUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GeocoderUnavailableError';
  }
}
