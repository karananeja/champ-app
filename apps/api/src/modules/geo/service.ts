import { toNameKey, type GeoResult, type GeoResultDto } from '@champ/shared';
import { HttpError } from '../../lib/errors';
import type { Geocoder } from '../../lib/geocoder';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';

const unavailable = () =>
  new HttpError(503, 'GEOCODER_UNAVAILABLE', 'Address lookup is unavailable; place the pin and type the address');

/** Any provider failure (error, timeout, bad response) becomes 503 GEOCODER_UNAVAILABLE. */
async function callGeocoder<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    logger.warn({ err }, 'Geocoder unavailable');
    throw unavailable();
  }
}

type ActiveLocation = { id: string; cityKey: string; stateKey: string };

async function activeLocations(): Promise<ActiveLocation[]> {
  const rows = await prisma.location.findMany({
    where: { active: true },
    select: { id: true, cityKey: true, state: { select: { nameKey: true } } },
  });
  return rows.map((l) => ({ id: l.id, cityKey: l.cityKey, stateKey: l.state.nameKey }));
}

/**
 * The active Location for a geocoder hit: same city (case-insensitive on cityKey) and, when the hit has a
 * state, the same state name. Only an unambiguous match is suggested.
 */
export function matchLocation(result: GeoResult, locations: ActiveLocation[]): string | undefined {
  if (!result.city) return undefined;
  const cityKey = toNameKey(result.city);
  const stateKey = result.state ? toNameKey(result.state) : undefined;
  const matches = locations.filter((l) => l.cityKey === cityKey && (!stateKey || l.stateKey === stateKey));
  return matches.length === 1 ? matches[0]!.id : undefined;
}

function withSuggestion(result: GeoResult, locations: ActiveLocation[]): GeoResultDto {
  const suggestedLocationId = matchLocation(result, locations);
  return suggestedLocationId ? { ...result, suggestedLocationId } : result;
}

export async function searchAddress(geocoder: Geocoder, q: string): Promise<GeoResultDto[]> {
  const results = await callGeocoder(() => geocoder.search(q, { limit: 5 }));
  if (results.length === 0) return [];
  const locations = await activeLocations();
  return results.map((r) => withSuggestion(r, locations));
}

export async function reverseGeocode(geocoder: Geocoder, lat: number, lng: number): Promise<GeoResultDto | null> {
  const result = await callGeocoder(() => geocoder.reverse(lat, lng));
  if (!result) return null;
  return withSuggestion(result, await activeLocations());
}
