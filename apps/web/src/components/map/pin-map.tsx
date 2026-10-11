import { useEffect, useMemo } from 'react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import type { LeafletEventHandlerFnMap, Marker as LeafletMarker } from 'leaflet';
import { INDIA_MAP_VIEW } from '@champ/shared';
import { cn } from '@/lib/utils';
import { OSM_ATTRIBUTION, OSM_TILE_URL, PIN_ZOOM, pinIcon } from './leaflet';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface PinMapProps {
  /** The pin, or null when none is placed yet. */
  position: LatLng | null;
  /** Called when the user clicks/taps the map or finishes dragging the pin. */
  onPick: (lat: number, lng: number) => void;
  /** Re-centres the map on this point whenever the object changes (e.g. after picking a search result). */
  focus?: LatLng | null;
  className?: string;
}

function ClickToPick({ onPick }: { onPick: PinMapProps['onPick'] }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

function FocusOn({ focus }: { focus: LatLng | null | undefined }) {
  const map = useMap();
  useEffect(() => {
    if (focus) map.setView([focus.lat, focus.lng], Math.max(map.getZoom(), PIN_ZOOM));
  }, [focus, map]);
  return null;
}

/** A map with one draggable pin. Click or tap to place it; drag to adjust. */
export function PinMap({ position, onPick, focus, className }: PinMapProps) {
  const icon = useMemo(() => pinIcon('active'), []);
  const handlers = useMemo<LeafletEventHandlerFnMap>(
    () => ({
      dragend: (e) => {
        const { lat, lng } = (e.target as LeafletMarker).getLatLng();
        onPick(lat, lng);
      },
    }),
    [onPick],
  );
  // The initial view only; later moves go through `focus`.
  const center: [number, number] = position ? [position.lat, position.lng] : [INDIA_MAP_VIEW.lat, INDIA_MAP_VIEW.lng];
  const zoom = position ? PIN_ZOOM : INDIA_MAP_VIEW.zoom;

  return (
    <div className={cn('isolate overflow-hidden rounded-md border', className)} data-testid="pin-map">
      <MapContainer center={center} zoom={zoom} className="h-full min-h-[280px] w-full" scrollWheelZoom>
        <TileLayer url={OSM_TILE_URL} attribution={OSM_ATTRIBUTION} />
        <ClickToPick onPick={onPick} />
        <FocusOn focus={focus} />
        {position && (
          <Marker
            position={[position.lat, position.lng]}
            icon={icon}
            draggable
            eventHandlers={handlers}
            title="Site pin (drag to adjust)"
          />
        )}
      </MapContainer>
    </div>
  );
}
