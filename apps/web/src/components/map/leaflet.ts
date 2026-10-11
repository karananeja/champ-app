import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/** OpenStreetMap tiles (D-020) and the attribution the tile usage policy requires. */
export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Zoom used when a pin is placed from a search result or shown on its own. */
export const PIN_ZOOM = 16;

const pinSvg = (fill: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40" viewBox="0 0 30 40" aria-hidden="true">` +
  `<path d="M15 1C7.3 1 1 7.2 1 14.9 1 25.4 15 39 15 39s14-13.6 14-24.1C29 7.2 22.7 1 15 1z" fill="${fill}" stroke="#fff" stroke-width="2"/>` +
  `<circle cx="15" cy="15" r="5" fill="#fff"/></svg>`;

/**
 * Marker icons as inline-SVG divIcons. Leaflet's default image icons resolve their URLs from CSS at runtime,
 * which breaks under Vite, so we don't use them.
 */
export const pinIcon = (variant: 'active' | 'inactive' = 'active') =>
  L.divIcon({
    className: 'champ-pin',
    html: pinSvg(variant === 'active' ? '#2563eb' : '#9ca3af'),
    iconSize: [30, 40],
    iconAnchor: [15, 39],
    popupAnchor: [0, -34],
  });
