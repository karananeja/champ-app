import { env } from '../../config/env';
import { OsrmRouter } from './osrm';
import type { RouteOptimizer } from './types';

export * from './types';
export { OsrmRouter, OSRM_MAX_ROUTE_POINTS, OSRM_MAX_STOPS, parseRoute, parseTrip } from './osrm';
export { haversineM, straightLineRoute, straightLineTrip } from './straight-line';
export { StubRouter } from './stub';

/** The default route optimiser: OSRM at `OSRM_URL`. */
export function createRouteOptimizer(): RouteOptimizer {
  return new OsrmRouter({ baseUrl: env.OSRM_URL });
}
