/** OpenStreetMap link centred on a point (zoom 17), e.g. for a technician's home location (F09). */
export const osmMapUrl = (lat: number, lng: number): string =>
  `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
