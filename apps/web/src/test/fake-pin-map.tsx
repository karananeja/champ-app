import type { PinMapProps } from '@/components/map/pin-map';

/**
 * jsdom stand-in for the Leaflet map (`vi.mock('@/components/map/pin-map', ...)`): shows the pin and offers a
 * button that "taps the map" at a fixed point.
 */
export function FakePinMap({ position, onPick }: PinMapProps) {
  return (
    <div data-testid="pin-map">
      <span data-testid="fake-pin">{position ? `${position.lat},${position.lng}` : 'none'}</span>
      <button type="button" onClick={() => onPick(12.9716, 77.5946)}>
        Tap map
      </button>
    </div>
  );
}
