import { makeRoute, makeStop } from '../test/route-fixtures';
import { directionsUrls, formatLeg, routeBounds, routeLine } from './route';

describe('route helpers', () => {
  it('formats legs, with distance only for straight-line legs', () => {
    expect(formatLeg({ distanceM: 3400, durationS: 720 })).toBe('3.4 km · 12 min from previous');
    expect(formatLeg({ distanceM: 250, durationS: 20 })).toBe('0.3 km · 1 min from previous');
    expect(formatLeg({ distanceM: 2000, durationS: null })).toBe('2.0 km from previous');
  });

  it('builds Directions URLs per platform', () => {
    expect(directionsUrls(13.03, 77.52, 'Peenya depot', 'ios')).toEqual(['http://maps.apple.com/?daddr=13.03,77.52']);
    expect(directionsUrls(13.03, 77.52, 'Peenya depot', 'android')).toEqual([
      'google.navigation:q=13.03,77.52',
      'geo:13.03,77.52?q=13.03,77.52(Peenya%20depot)',
    ]);
  });

  it('draws the router geometry, else straight segments from the origin through the open stops', () => {
    const stops = [
      makeStop({ done: true, fitment: { id: 'f0', site: { name: 'A', address: null, lat: 1, lng: 2 } } }),
      makeStop({ fitment: { id: 'f1', site: { name: 'B', address: null, lat: 3, lng: 4 } } }),
      makeStop({ fitment: { id: 'f2', site: { name: 'C', address: null, lat: 5, lng: 6 } } }),
    ];
    expect(routeLine(makeRoute({ stops }))).toEqual([[77.59, 12.97], [77.52, 13.03]]);
    expect(routeLine(makeRoute({ stops, geometry: null, origin: { lat: 0, lng: 0, source: 'HOME' } }))).toEqual([[0, 0], [4, 3], [6, 5]]);
    expect(routeBounds(makeRoute({ stops, origin: null }))).toEqual([2, 1, 6, 5]);
    expect(routeBounds(makeRoute({ stops: [], origin: null }))).toBeNull();
  });
});
