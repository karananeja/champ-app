import { Router } from 'express';
import {
  CLIENT_EDIT_ROLES,
  geoReverseQuerySchema,
  geoSearchQuerySchema,
  type GeoReverseQuery,
  type GeoReverseResponse,
  type GeoSearchQuery,
  type GeoSearchResponse,
} from '@champ/shared';
import type { Geocoder } from '../../lib/geocoder';
import { authenticate } from '../../middleware/auth';
import { requireRole } from '../../middleware/requireRole';
import { validate } from '../../middleware/validate';
import { reverseGeocode, searchAddress } from './service';

/** `/geo/*`: address search and reverse lookup, proxied to the geocoder (D-054). SA and OM only. */
export function geoRouter(geocoder: Geocoder) {
  const router = Router();
  router.use(authenticate, requireRole(...CLIENT_EDIT_ROLES));

  router.get('/search', validate({ query: geoSearchQuerySchema }), async (req, res) => {
    const { q } = req.query as unknown as GeoSearchQuery;
    const body: GeoSearchResponse = { items: await searchAddress(geocoder, q) };
    res.json(body);
  });

  router.get('/reverse', validate({ query: geoReverseQuerySchema }), async (req, res) => {
    const { lat, lng } = req.query as unknown as GeoReverseQuery;
    const body: GeoReverseResponse = { item: await reverseGeocode(geocoder, lat, lng) };
    res.json(body);
  });

  return router;
}
