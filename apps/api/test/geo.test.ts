import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GeoResult } from '@champ/shared';
import { createApp } from '../src/app';
import { GeocoderUnavailableError, NominatimGeocoder, type Geocoder } from '../src/lib/geocoder';
import { bearer, createLocation, createLookup, createOrg, fakeGoogle } from './helpers';

/** A fake geocoder: tests never call the real Nominatim. */
function fakeGeocoder(overrides: Partial<Geocoder> = {}) {
  const geocoder = {
    search: vi.fn<Geocoder['search']>(async () => []),
    reverse: vi.fn<Geocoder['reverse']>(async () => null),
    ...overrides,
  };
  return geocoder;
}

const geoApi = (geocoder: Geocoder) => request(createApp({ google: fakeGoogle(null), geocoder }));

const mgRoad: GeoResult = {
  displayName: 'MG Road, Bengaluru, Karnataka, 560001, India',
  lat: 12.975,
  lng: 77.606,
  city: 'Bengaluru',
  state: 'Karnataka',
  postcode: '560001',
};

async function karnatakaBengaluru() {
  const karnataka = await createLookup('STATE', 'Karnataka');
  return createLocation({ city: 'Bengaluru', stateId: karnataka.id });
}

describe('GET /api/geo/search', () => {
  it('returns results with the matching active Location as suggestedLocationId', async () => {
    const { om } = await createOrg();
    const blr = await karnatakaBengaluru();
    const unknownCity: GeoResult = { displayName: 'Somewhere', lat: 10, lng: 76, city: 'Nowhere', state: 'Kerala' };
    const geocoder = fakeGeocoder({ search: vi.fn(async () => [mgRoad, unknownCity]) });

    const res = await geoApi(geocoder).get('/api/geo/search').query({ q: '  MG Road ' }).set(bearer(om));
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([{ ...mgRoad, suggestedLocationId: blr.id }, unknownCity]);
    expect(geocoder.search).toHaveBeenCalledWith('MG Road', { limit: 5 });
  });

  it('matches city and state case-insensitively and ignores inactive or other-state locations', async () => {
    const { sa } = await createOrg();
    const karnataka = await createLookup('STATE', 'Karnataka');
    const goa = await createLookup('STATE', 'Goa');
    const blr = await createLocation({ city: 'Bengaluru', stateId: karnataka.id });
    await createLocation({ city: 'Bengaluru', stateId: goa.id }); // same city name in another state
    await createLocation({ city: 'Mysuru', stateId: karnataka.id, active: false });

    const hits: GeoResult[] = [
      { displayName: 'a', lat: 1, lng: 1, city: 'BENGALURU', state: 'karnataka' },
      { displayName: 'b', lat: 1, lng: 1, city: 'Mysuru', state: 'Karnataka' },
      { displayName: 'c', lat: 1, lng: 1, city: 'Bengaluru' }, // no state: ambiguous (two states)
      { displayName: 'd', lat: 1, lng: 1, state: 'Karnataka' }, // no city
    ];
    const res = await geoApi(fakeGeocoder({ search: vi.fn(async () => hits) }))
      .get('/api/geo/search')
      .query({ q: 'test' })
      .set(bearer(sa));
    expect(res.body.items.map((i: { suggestedLocationId?: string }) => i.suggestedLocationId)).toEqual([
      blr.id,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('needs at least 3 characters', async () => {
    const { om } = await createOrg();
    const geocoder = fakeGeocoder();
    const res = await geoApi(geocoder).get('/api/geo/search').query({ q: 'ab' }).set(bearer(om));
    expect(res.status).toBe(400);
    expect(res.body.error.details.fieldErrors.q).toEqual(['Type at least 3 characters']);
    expect(geocoder.search).not.toHaveBeenCalled();
  });

  it('maps geocoder failures to 503 GEOCODER_UNAVAILABLE', async () => {
    const { om } = await createOrg();
    for (const error of [new GeocoderUnavailableError('down'), new Error('boom')]) {
      const geocoder = fakeGeocoder({ search: vi.fn(async () => Promise.reject(error)) });
      const res = await geoApi(geocoder).get('/api/geo/search').query({ q: 'MG Road' }).set(bearer(om));
      expect(res.status).toBe(503);
      expect(res.body.error).toEqual({
        code: 'GEOCODER_UNAVAILABLE',
        message: 'Address lookup is unavailable; place the pin and type the address',
      });
    }
  });

  it('is limited to SA and OM', async () => {
    const org = await createOrg();
    const geocoder = fakeGeocoder();
    for (const role of ['OE', 'RO', 'OT'] as const) {
      expect((await geoApi(geocoder).get('/api/geo/search').query({ q: 'MG Road' }).set(bearer(org[role]))).status).toBe(403);
      expect((await geoApi(geocoder).get('/api/geo/reverse').query({ lat: 1, lng: 1 }).set(bearer(org[role]))).status).toBe(403);
    }
    expect((await geoApi(geocoder).get('/api/geo/search').query({ q: 'MG Road' })).status).toBe(401);
    expect(geocoder.search).not.toHaveBeenCalled();
  });
});

describe('GET /api/geo/reverse', () => {
  it('returns the address with a suggested location', async () => {
    const { om } = await createOrg();
    const blr = await karnatakaBengaluru();
    const geocoder = fakeGeocoder({ reverse: vi.fn(async () => mgRoad) });
    const res = await geoApi(geocoder).get('/api/geo/reverse').query({ lat: '12.975', lng: '77.606' }).set(bearer(om));
    expect(res.status).toBe(200);
    expect(res.body.item).toEqual({ ...mgRoad, suggestedLocationId: blr.id });
    expect(geocoder.reverse).toHaveBeenCalledWith(12.975, 77.606);
  });

  it('returns null when nothing is found', async () => {
    const { om } = await createOrg();
    const res = await geoApi(fakeGeocoder()).get('/api/geo/reverse').query({ lat: 0, lng: 0 }).set(bearer(om));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ item: null });
  });

  it('validates lat/lng and maps failures to 503', async () => {
    const { om } = await createOrg();
    const bad = await geoApi(fakeGeocoder()).get('/api/geo/reverse').query({ lat: 91, lng: 0 }).set(bearer(om));
    expect(bad.status).toBe(400);
    const down = fakeGeocoder({ reverse: vi.fn(async () => Promise.reject(new GeocoderUnavailableError('timeout'))) });
    const res = await geoApi(down).get('/api/geo/reverse').query({ lat: 12, lng: 77 }).set(bearer(om));
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('GEOCODER_UNAVAILABLE');
  });
});

// --- NominatimGeocoder with a fake fetch (no network) ---

const place = {
  lat: '12.9750',
  lon: '77.6060',
  display_name: 'MG Road, Bengaluru, Karnataka, 560001, India',
  address: { road: 'MG Road', city: 'Bengaluru', state: 'Karnataka', postcode: '560001' },
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function nominatim(fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof NominatimGeocoder>[0]> = {}) {
  return new NominatimGeocoder({
    baseUrl: 'https://nominatim.test/',
    contactEmail: 'ops@example.com',
    fetch: fetchImpl,
    minIntervalMs: 0,
    ...extra,
  });
}

describe('NominatimGeocoder', () => {
  afterEach(() => vi.useRealTimers());

  it('sends the identifying User-Agent and the India/English/limit parameters, and maps results', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([place, { ...place, address: { village: 'Hosur', state: 'Tamil Nadu' } }]));
    const results = await nominatim(fetchMock).search('  MG Road ');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://nominatim.test/search');
    expect(Object.fromEntries(parsed.searchParams)).toMatchObject({
      q: 'MG Road',
      countrycodes: 'in',
      addressdetails: '1',
      limit: '5',
      'accept-language': 'en',
    });
    expect((init.headers as Record<string, string>)['User-Agent']).toBe('Champ/0.1 (ops@example.com)');
    expect(results).toEqual([
      {
        displayName: place.display_name,
        lat: 12.975,
        lng: 77.606,
        city: 'Bengaluru',
        state: 'Karnataka',
        postcode: '560001',
      },
      // city falls back to town, village or county
      { displayName: place.display_name, lat: 12.975, lng: 77.606, city: 'Hosur', state: 'Tamil Nadu' },
    ]);
  });

  it('reverse: maps the place, and "Unable to geocode" to null', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(place))
      .mockResolvedValueOnce(jsonResponse({ error: 'Unable to geocode' }));
    const geocoder = nominatim(fetchMock as unknown as typeof fetch);
    expect(await geocoder.reverse(12.975, 77.606)).toMatchObject({ city: 'Bengaluru', lat: 12.975 });
    expect(await geocoder.reverse(0, 0)).toBeNull();
    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.pathname).toBe('/reverse');
    expect(url.searchParams.get('lat')).toBe('12.975000');
    expect(url.searchParams.get('lon')).toBe('77.606000');
  });

  it('caches search by normalised query and reverse by lat/lng rounded to 5 decimals', async () => {
    const fetchMock = vi.fn(async (url: string) => jsonResponse(url.includes('/search') ? [place] : place));
    const geocoder = nominatim(fetchMock as unknown as typeof fetch);

    await geocoder.search('MG Road');
    await geocoder.search('  mg   ROAD ');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await geocoder.search('Brigade Road');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await geocoder.reverse(12.975001, 77.606001);
    await geocoder.reverse(12.975004, 77.606004); // same 5-decimal key
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await geocoder.reverse(12.97502, 77.606);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('cache entries expire after the TTL; errors are not cached', async () => {
    let now = 1_000_000;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockImplementation(async () => jsonResponse([place]));
    const geocoder = nominatim(fetchMock as unknown as typeof fetch, { now: () => now, cacheTtlMs: 1000 });

    await expect(geocoder.search('MG Road')).rejects.toBeInstanceOf(GeocoderUnavailableError);
    await geocoder.search('MG Road');
    await geocoder.search('MG Road');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    now += 1001;
    await geocoder.search('MG Road');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('evicts the least recently used entry beyond the cache size', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([place]));
    const geocoder = nominatim(fetchMock, { cacheSize: 2 });
    await geocoder.search('aaa');
    await geocoder.search('bbb');
    await geocoder.search('aaa'); // hit: aaa is now most recent
    await geocoder.search('ccc'); // evicts bbb
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await geocoder.search('aaa');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await geocoder.search('bbb');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('throws GeocoderUnavailableError on HTTP errors, network errors and bad payloads', async () => {
    const http = nominatim(vi.fn(async () => jsonResponse({}, 503)));
    await expect(http.search('MG Road')).rejects.toBeInstanceOf(GeocoderUnavailableError);
    const network = nominatim(vi.fn(async () => Promise.reject(new TypeError('fetch failed'))));
    await expect(network.search('MG Road')).rejects.toBeInstanceOf(GeocoderUnavailableError);
    const payload = nominatim(vi.fn(async () => jsonResponse({ not: 'an array' })));
    await expect(payload.search('MG Road')).rejects.toBeInstanceOf(GeocoderUnavailableError);
  });

  it('times out after 5 s', async () => {
    vi.useFakeTimers();
    const hanging = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const geocoder = nominatim(hanging as unknown as typeof fetch);
    const result = geocoder.search('MG Road');
    const assertion = expect(result).rejects.toThrow('Nominatim request timed out');
    await vi.advanceTimersByTimeAsync(4999);
    expect(hanging).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
  });

  it('spaces requests at least 1 s apart, one at a time (fake timers)', async () => {
    vi.useFakeTimers();
    const starts: number[] = [];
    const fetchMock = vi.fn(async () => {
      starts.push(Date.now());
      return jsonResponse([place]);
    });
    const geocoder = nominatim(fetchMock, { minIntervalMs: 1000 });
    const t0 = Date.now();

    const all = Promise.all([geocoder.search('one'), geocoder.search('two'), geocoder.reverse(1, 2)]);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    await all;
    expect(starts.map((s) => s - t0)).toEqual([0, 1000, 2000]);

    // A cache hit doesn't wait for the throttle.
    await geocoder.search('one');
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // After a quiet period, the next request goes out straight away.
    await vi.advanceTimersByTimeAsync(5000);
    const before = Date.now();
    await geocoder.search('four');
    expect(starts.at(-1)).toBe(before);
  });

  it('a failed request does not block the queue', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockImplementation(async () => jsonResponse([place]));
    const geocoder = nominatim(fetchMock as unknown as typeof fetch, { minIntervalMs: 1000 });
    const first = expect(geocoder.search('one')).rejects.toBeInstanceOf(GeocoderUnavailableError);
    const second = geocoder.search('two');
    await vi.advanceTimersByTimeAsync(1000);
    await first;
    await expect(second).resolves.toHaveLength(1);
  });
});
