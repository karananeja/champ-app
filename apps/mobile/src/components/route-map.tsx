import type { DayRouteDto } from '@champ/shared';
import { Camera, GeoJSONSource, Layer, Map, Marker, type CameraRef } from '@maplibre/maplibre-react-native';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { requireFreshFix, type Fix } from '../lib/location';
import { routeBounds, routeLine } from '../lib/route';
import { useToast } from './toast';
import { useTheme } from '../theme/use-theme';
import { OSM_STYLE } from './location-map';

const DONE_GREY = '#9ca3af';
const PADDING = { top: 48, right: 40, bottom: 40, left: 40 };
const LOCATE_ZOOM = 15;
export const LOCATE_DENIED_MESSAGE = 'Allow location access for Champ to show where you are.';
export const LOCATE_UNAVAILABLE_MESSAGE = "Couldn't get your location. Try again in a moment.";

/** The day route (F10 §5): the line, numbered stops (done grey with a tick, next in primary) and the origin. */
export function RouteMap({ route }: { route: DayRouteDto }) {
  const { colors } = useTheme();
  const showToast = useToast();
  const line = routeLine(route);
  const bounds = routeBounds(route);
  const cameraRef = useRef<CameraRef>(null);
  const [me, setMe] = useState<Fix | null>(null);
  const [locating, setLocating] = useState(false);

  // CR-07: "Locate me" takes a fresh fix, shows it and flies the map there. It doesn't change the route.
  async function locate() {
    setLocating(true);
    const result = await requireFreshFix();
    setLocating(false);
    if (!result.ok) {
      showToast(result.reason === 'denied' ? LOCATE_DENIED_MESSAGE : LOCATE_UNAVAILABLE_MESSAGE);
      return;
    }
    setMe(result.fix);
    cameraRef.current?.flyTo({ center: [result.fix.lng, result.fix.lat], zoom: LOCATE_ZOOM, duration: 800 });
  }

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
          <Camera ref={cameraRef} bounds={bounds} padding={PADDING} duration={0} maxZoom={16} />
        ) : (
          <Camera ref={cameraRef} initialViewState={{ center: [78.9629, 20.5937], zoom: 4 }} />
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
        {me ? (
          <Marker id="my-location" lngLat={[me.lng, me.lat]}>
            <View testID="my-location" style={[styles.me, { backgroundColor: colors.primary }]} />
          </Marker>
        ) : null}
      </Map>
      <Text style={styles.attribution}>© OpenStreetMap contributors</Text>
      <Pressable
        testID="locate-me"
        accessibilityRole="button"
        accessibilityLabel="Locate me"
        disabled={locating}
        onPress={() => void locate()}
        style={[styles.locate, { backgroundColor: colors.card, borderColor: colors.border }]}
      >
        {locating ? <ActivityIndicator color={colors.primary} /> : <Text style={[styles.locateIcon, { color: colors.primary }]}>◎</Text>}
      </Pressable>
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
  me: { width: 18, height: 18, borderRadius: 9, borderWidth: 3, borderColor: '#ffffff' },
  locate: {
    position: 'absolute',
    right: 12,
    bottom: 28,
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  locateIcon: { fontSize: 24, lineHeight: 26 },
  attribution: { position: 'absolute', left: 6, bottom: 4, fontSize: 10, color: '#333', backgroundColor: 'rgba(255,255,255,0.7)', paddingHorizontal: 4 },
});
