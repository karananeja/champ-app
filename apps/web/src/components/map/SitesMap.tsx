import { useEffect, useMemo } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import { INDIA_MAP_VIEW } from '@champ/shared';
import { cn } from '@/lib/utils';
import { OSM_ATTRIBUTION, OSM_TILE_URL, PIN_ZOOM, pinIcon } from './leaflet';

export interface MapSite {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  active: boolean;
}

/** Fits the view to all markers (or zooms in on a single one). */
function FitToSites({ sites }: { sites: MapSite[] }) {
  const map = useMap();
  useEffect(() => {
    if (sites.length === 0) return;
    if (sites.length === 1) {
      map.setView([sites[0]!.lat, sites[0]!.lng], PIN_ZOOM - 1);
      return;
    }
    map.fitBounds(L.latLngBounds(sites.map((s) => [s.lat, s.lng] as [number, number])), {
      padding: [32, 32],
      maxZoom: PIN_ZOOM - 1,
    });
  }, [map, sites]);
  return null;
}

/** All of a client's sites on one map: active ones in blue, inactive ones in grey. */
export function SitesMap({ sites, className }: { sites: MapSite[]; className?: string }) {
  const icons = useMemo(() => ({ active: pinIcon('active'), inactive: pinIcon('inactive') }), []);
  return (
    <div className={cn('isolate overflow-hidden rounded-md border', className)} data-testid="sites-map">
      <MapContainer
        center={[INDIA_MAP_VIEW.lat, INDIA_MAP_VIEW.lng]}
        zoom={INDIA_MAP_VIEW.zoom}
        className="h-full min-h-[280px] w-full"
        scrollWheelZoom={false}
      >
        <TileLayer url={OSM_TILE_URL} attribution={OSM_ATTRIBUTION} />
        <FitToSites sites={sites} />
        {sites.map((site) => (
          <Marker
            key={site.id}
            position={[site.lat, site.lng]}
            icon={site.active ? icons.active : icons.inactive}
            title={site.name}
            zIndexOffset={site.active ? 100 : 0}
          >
            <Popup>
              <div className="font-medium">
                {site.name}
                {!site.active && ' (inactive)'}
              </div>
              <div className="text-xs">{site.address}</div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
