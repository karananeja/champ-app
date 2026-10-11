import { toNameKey } from '@champ/shared';
import { LruCache } from './lru';
import { SerialThrottle } from './throttle';
import { GeocoderUnavailableError, type GeoResult, type Geocoder, type GeoSearchOptions } from './types';

export interface NominatimOptions {
  /** e.g. https://nominatim.openstreetmap.org (no trailing slash needed). */
  baseUrl: string;
  /** Contact address sent in the User-Agent, as the usage policy asks. */
  contactEmail: string;
  /** Injected in tests; defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Minimum gap between request starts (default 1000 ms). */
  minIntervalMs?: number;
  /** Per-request timeout (default 5000 ms). */
  timeoutMs?: number;
  cacheSize?: number;
  cacheTtlMs?: number;
  now?: () => number;
}

interface NominatimAddress {
  city?: string;
  town?: string;
  village?: string;
  county?: string;
  state?: string;
  postcode?: string;
}

interface NominatimPlace {
  lat: string;
  lon: string;
  display_name: string;
  address?: NominatimAddress;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function toGeoResult(place: NominatimPlace): GeoResult | null {
  const lat = Number(place.lat);
  const lng = Number(place.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || typeof place.display_name !== 'string') return null;
  const address = place.address ?? {};
  const city = address.city ?? address.town ?? address.village ?? address.county;
  return {
    displayName: place.display_name,
    lat,
    lng,
    ...(city ? { city } : {}),
    ...(address.state ? { state: address.state } : {}),
    ...(address.postcode ? { postcode: address.postcode } : {}),
  };
}

/**
 * Nominatim (OpenStreetMap) geocoder. Requests are serialised and spaced ≥1 s apart, identified with a
 * `User-Agent`, and results are kept in an LRU cache (search by normalised query, reverse by lat/lng rounded
 * to 5 decimals). Upstream errors and timeouts throw `GeocoderUnavailableError`.
 */
export class NominatimGeocoder implements Geocoder {
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly throttle: SerialThrottle;
  private readonly cache: LruCache<string, GeoResult[] | GeoResult | null>;

  constructor(options: NominatimOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.userAgent = `Champ/0.1 (${options.contactEmail})`;
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.throttle = new SerialThrottle(options.minIntervalMs ?? 1000, options.now);
    this.cache = new LruCache(options.cacheSize ?? 500, options.cacheTtlMs ?? DAY_MS, options.now);
  }

  async search(q: string, opts: GeoSearchOptions = {}): Promise<GeoResult[]> {
    const limit = opts.limit ?? 5;
    const key = `s:${limit}:${toNameKey(q)}`;
    if (this.cache.has(key)) return this.cache.get(key) as GeoResult[];

    const body = await this.request('/search', {
      q: q.trim(),
      format: 'jsonv2',
      countrycodes: 'in',
      addressdetails: '1',
      limit: String(limit),
      'accept-language': 'en',
    });
    if (!Array.isArray(body)) throw new GeocoderUnavailableError('Unexpected search response');
    const results = (body as NominatimPlace[]).map(toGeoResult).filter((r): r is GeoResult => r !== null);
    this.cache.set(key, results);
    return results;
  }

  async reverse(lat: number, lng: number): Promise<GeoResult | null> {
    const key = `r:${lat.toFixed(5)},${lng.toFixed(5)}`;
    if (this.cache.has(key)) return this.cache.get(key) as GeoResult | null;

    const body = (await this.request('/reverse', {
      lat: lat.toFixed(6),
      lon: lng.toFixed(6),
      format: 'jsonv2',
      addressdetails: '1',
      zoom: '18',
      'accept-language': 'en',
    })) as (NominatimPlace & { error?: string }) | null;
    // Nominatim answers 200 with `{ error: "Unable to geocode" }` when nothing is there (e.g. the sea).
    const result = body && !body.error ? toGeoResult(body) : null;
    this.cache.set(key, result);
    return result;
  }

  private request(path: string, params: Record<string, string>): Promise<unknown> {
    const url = `${this.baseUrl}${path}?${new URLSearchParams(params)}`;
    return this.throttle.run(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await this.fetchImpl(url, {
          headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
          signal: controller.signal,
        });
        if (!res.ok) throw new GeocoderUnavailableError(`Nominatim responded ${res.status}`);
        return (await res.json()) as unknown;
      } catch (err) {
        if (err instanceof GeocoderUnavailableError) throw err;
        const reason = controller.signal.aborted ? 'timed out' : 'failed';
        throw new GeocoderUnavailableError(`Nominatim request ${reason}`, { cause: err });
      } finally {
        clearTimeout(timer);
      }
    });
  }
}
