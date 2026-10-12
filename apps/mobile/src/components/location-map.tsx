import { Camera, Map, type CameraRef, type StyleSpecification } from '@maplibre/maplibre-react-native';
import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/use-theme';

/** OpenStreetMap raster tiles (D-133): no API key; attribution shown on the map. */
export const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

export interface LngLatTarget {
  lng: number;
  lat: number;
  /** Changes on every programmatic move, so moving to the same point twice still animates. */
  seq: number;
}

/** A map with a fixed centre pin: the pin is wherever the map centre is. */
export function LocationMap({
  initial,
  target,
  onCenterChange,
}: {
  initial: { lng: number; lat: number; zoom: number };
  target: LngLatTarget | null;
  onCenterChange: (lng: number, lat: number) => void;
}) {
  const { colors } = useTheme();
  const camera = useRef<CameraRef>(null);

  useEffect(() => {
    if (target) camera.current?.flyTo({ center: [target.lng, target.lat], zoom: 16, duration: 800 });
  }, [target]);

  return (
    <View style={styles.wrap}>
      <Map
        style={StyleSheet.absoluteFill}
        mapStyle={OSM_STYLE}
        attribution
        logo={false}
        compass={false}
        touchRotate={false}
        touchPitch={false}
        onRegionDidChange={(e) => {
          const [lng, lat] = e.nativeEvent.center;
          onCenterChange(lng, lat);
        }}
      >
        <Camera ref={camera} initialViewState={{ center: [initial.lng, initial.lat], zoom: initial.zoom }} />
      </Map>
      <View pointerEvents="none" style={styles.pinWrap}>
        <View style={[styles.pin, { backgroundColor: colors.primary, borderColor: '#ffffff' }]} />
        <View style={[styles.pinStem, { backgroundColor: colors.primary }]} />
      </View>
      <Text style={styles.attribution}>© OpenStreetMap contributors</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 280, borderRadius: 14, overflow: 'hidden' },
  pinWrap: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingBottom: 28 },
  pin: { width: 22, height: 22, borderRadius: 11, borderWidth: 3 },
  pinStem: { width: 3, height: 12 },
  attribution: { position: 'absolute', left: 6, bottom: 4, fontSize: 10, color: '#333', backgroundColor: 'rgba(255,255,255,0.7)', paddingHorizontal: 4 },
});
