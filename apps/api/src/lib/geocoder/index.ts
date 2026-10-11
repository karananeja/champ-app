import { env } from '../../config/env';
import { NominatimGeocoder } from './nominatim';
import type { Geocoder } from './types';

export * from './types';
export { NominatimGeocoder } from './nominatim';

/** The default geocoder: Nominatim at `NOMINATIM_URL`, identified with `GEOCODER_CONTACT_EMAIL`. */
export function createGeocoder(): Geocoder {
  return new NominatimGeocoder({ baseUrl: env.NOMINATIM_URL, contactEmail: env.GEOCODER_CONTACT_EMAIL });
}
