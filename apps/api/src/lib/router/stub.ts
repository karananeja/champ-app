import { straightLineTrip } from './straight-line';
import { RouterUnavailableError, type LatLng, type RouteOptimizer, type TripResult } from './types';

/**
 * In-memory optimiser for tests. By default it reverses the nearest-neighbour order (so a test can tell an
 * OSRM order from the fallback) with 1.5× legs, 60 s per km and a straight geometry; `fail` makes it throw.
 */
export class StubRouter implements RouteOptimizer {
  calls: { origin: LatLng; stops: LatLng[] }[] = [];
  fail = false;

  async trip(origin: LatLng, stops: LatLng[]): Promise<TripResult> {
    this.calls.push({ origin, stops });
    if (this.fail) throw new RouterUnavailableError('stub failure');
    const order = straightLineTrip(origin, stops).order.reverse();
    const points = [origin, ...order.map((i) => stops[i]!)];
    const legs = order.map((_, k) => {
      const d = straightLineTrip(points[k]!, [points[k + 1]!]).legs[0]!.distanceM;
      return { distanceM: Math.round(d * 1.5), durationS: Math.round((d * 1.5) / 1000) * 60 };
    });
    return { order, legs, geometry: { type: 'LineString', coordinates: points.map((p) => [p.lng, p.lat]) } };
  }
}
