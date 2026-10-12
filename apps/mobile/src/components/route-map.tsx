import type { DayRouteDto } from '@champ/shared';
import { Camera, GeoJSONSource, Layer, Map, Marker } from '@maplibre/maplibre-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { routeBounds, routeLine } from '../lib/route';
import { useTheme } from '../theme/use-theme';
import { OSM_STYLE } from './location-map';

const DONE_GREY = '#9ca3af';
const PADDING = { top: 48, right: 40, bottom: 40, left: 40 };

/** The day route (F10 §5): the line, numbered stops (done grey with a tick, next in primary) and the origin. */
export function RouteMap({ route }: { route: DayRouteDto }) {
  const { colors } = useTheme();
  const line = routeLine(route);
  const bounds = routeBounds(route);

  return (
    <View style={styles.wrap} testID="route-map">
      <Map
        style={StyleSheet.absoluteFill}
        mapStyle={OSM_STYLE}
        attribution
        logo={false}
        compass={false}
        touchRotate={false}
        touchPitch={false}
      >
        {bounds ? (
          <Camera bounds={bounds} padding={PADDING} duration={0} maxZoom={16} />
        ) : (
          <Camera initialViewState={{ center: [78.9629, 20.5937], zoom: 4 }} />
        )}
        {line.length >= 2 ? (
          <GeoJSONSource id="route" data={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } }}>
            <Layer
              type="line"
              id="route-line"
              layout={{ 'line-join': 'round', 'line-cap': 'round' }}
              paint={{ 'line-color': colors.primary, 'line-width': 4, 'line-opacity': 0.85 }}
            />
          </GeoJSONSource>
        ) : null}
        {route.origin ? (
          <Marker id="origin" lngLat={[route.origin.lng, route.origin.lat]}>
            <View testID={`origin-${route.origin.source}`} style={[styles.origin, { borderColor: colors.primary }]}>
              <Text style={[styles.originText, { color: colors.primary }]}>{route.origin.source === 'GPS' ? 'You' : '⌂'}</Text>
            </View>
          </Marker>
        ) : null}
        {route.stops.map((s) => {
          const { lat, lng } = s.fitment.site;
          if (lat === null || lng === null) return null;
          const bg = s.done ? DONE_GREY : s.isNext ? colors.primary : '#ffffff';
          const fg = s.done || s.isNext ? '#ffffff' : colors.primary;
          return (
            <Marker key={s.fitment.id} id={`stop-${s.fitment.id}`} lngLat={[lng, lat]}>
              <View testID={`marker-${s.fitment.id}`} style={[styles.stop, { backgroundColor: bg, borderColor: s.done ? DONE_GREY : colors.primary }]}>
                <Text style={[styles.stopText, { color: fg }]}>{s.done ? '✓' : String(s.order)}</Text>
              </View>
            </Marker>
          );
        })}
      </Map>
      <Text style={styles.attribution}>© OpenStreetMap contributors</Text>
    </View>
  );
}

/** A small map centred on one site with a pin (fitment detail). */
export function SiteMap({ lat, lng }: { lat: number; lng: number }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.wrap, styles.small]} testID="site-map">
      <Map style={StyleSheet.absoluteFill} mapStyle={OSM_STYLE} attribution logo={false} compass={false} touchRotate={false} touchPitch={false}>
        <Camera initialViewState={{ center: [lng, lat], zoom: 15 }} />
        <Marker id="site" lngLat={[lng, lat]}>
          <View style={[styles.stop, { backgroundColor: colors.primary, borderColor: '#ffffff' }]} />
        </Marker>
      </Map>
      <Text style={styles.attribution}>© OpenStreetMap contributors</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, overflow: 'hidden' },
  small: { flex: 0, height: 180, borderRadius: 14 },
  stop: { minWidth: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  stopText: { fontSize: 13, fontWeight: '700' },
  origin: { paddingHorizontal: 6, height: 26, borderRadius: 13, borderWidth: 2, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center' },
  originText: { fontSize: 12, fontWeight: '700' },
  attribution: { position: 'absolute', left: 6, bottom: 4, fontSize: 10, color: '#333', backgroundColor: 'rgba(255,255,255,0.7)', paddingHorizontal: 4 },
});
