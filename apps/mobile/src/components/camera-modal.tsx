import { CameraView, useCameraPermissions, type BarcodeType } from 'expo-camera';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SourceImage } from '../lib/photo-pipeline';
import { useTheme } from '../theme/use-theme';
import { Button } from './ui';

/** F10B §6: the codes the device-id scan reads. */
export const SCAN_BARCODE_TYPES: BarcodeType[] = ['code128', 'code39', 'ean13', 'qr', 'datamatrix'];

export const CAMERA_DENIED_TEXT =
  'Champ needs the camera to take fitment photos and scan device ids. Allow camera access in Settings, then try again.';

/**
 * A full-screen camera (rear). `photo` mode: a shutter and a flash toggle. `scan` mode: reads barcodes and QR codes
 * (the first one read goes to `onBarcode`; pass `paused` while confirming it) and has a *Read text* button that takes
 * a picture for text recognition. A denied permission shows an explanation with *Open settings*.
 */
export function CameraModal({
  visible,
  mode,
  onClose,
  onPicture,
  onBarcode,
  paused,
  busy,
  overlay,
  testID = 'camera',
}: {
  visible: boolean;
  mode: 'photo' | 'scan';
  onClose: () => void;
  /** Photo mode: the shutter; scan mode: *Read text*. */
  onPicture: (picture: SourceImage) => void;
  onBarcode?: (value: string) => void;
  /** Stop reading codes (e.g. while a read code is being confirmed). */
  paused?: boolean;
  /** Show a spinner over the controls (e.g. while text is being read). */
  busy?: boolean;
  /** A panel shown over the camera, inside its modal (a second modal on top is unreliable on iOS). */
  overlay?: ReactNode;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [light, setLight] = useState(false);
  const [taking, setTaking] = useState(false);
  const camera = useRef<CameraView>(null);
  const scanned = useRef(false);

  useEffect(() => {
    if (visible && permission && !permission.granted && permission.canAskAgain) void requestPermission();
  }, [visible, permission, requestPermission]);

  useEffect(() => {
    if (visible && !paused) scanned.current = false;
  }, [visible, paused]);

  const take = async () => {
    if (!camera.current || taking) return;
    setTaking(true);
    try {
      const pic = await camera.current.takePictureAsync({ quality: 1 });
      if (pic) onPicture({ uri: pic.uri, width: pic.width, height: pic.height });
    } finally {
      setTaking(false);
    }
  };

  const denied = permission != null && !permission.granted && !permission.canAskAgain;
  const ready = permission?.granted === true;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View testID={testID} style={styles.root}>
        {denied ? (
          <PermissionDenied onClose={onClose} />
        ) : ready ? (
          <>
            <CameraView
              ref={camera}
              testID={`${testID}-view`}
              style={StyleSheet.absoluteFill}
              facing="back"
              flash={mode === 'photo' && light ? 'on' : 'off'}
              enableTorch={mode === 'scan' && light}
              barcodeScannerSettings={mode === 'scan' ? { barcodeTypes: SCAN_BARCODE_TYPES } : undefined}
              onBarcodeScanned={
                mode === 'scan' && onBarcode && !paused
                  ? (r) => {
                      if (scanned.current || !r.data) return;
                      scanned.current = true;
                      onBarcode(r.data.trim());
                    }
                  : undefined
              }
            />
            <View style={[styles.top, { paddingTop: insets.top + 12 }]}>
              <RoundButton label="Close" onPress={onClose} testID={`${testID}-close`} />
              <RoundButton
                label={mode === 'photo' ? (light ? 'Flash on' : 'Flash off') : light ? 'Light on' : 'Light off'}
                onPress={() => setLight((v) => !v)}
                testID={`${testID}-flash`}
              />
            </View>
            {mode === 'scan' ? (
              <Text style={[styles.hint, { top: insets.top + 72 }]}>Point at the barcode or QR code, or read the printed id</Text>
            ) : null}
            <View style={[styles.bottom, { paddingBottom: insets.bottom + 24 }]}>
              {busy || taking ? (
                <ActivityIndicator color="#ffffff" size="large" testID={`${testID}-busy`} />
              ) : mode === 'photo' ? (
                <Pressable
                  testID={`${testID}-shutter`}
                  accessibilityRole="button"
                  accessibilityLabel="Take photo"
                  onPress={() => void take()}
                  style={({ pressed }) => [styles.shutter, pressed && { opacity: 0.7 }]}
                />
              ) : (
                <RoundButton label="Read text" onPress={() => void take()} testID={`${testID}-read-text`} />
              )}
            </View>
            {overlay ? (
              <View style={[styles.overlay, { paddingBottom: insets.bottom + 16 }]}>
                <OverlayCard>{overlay}</OverlayCard>
              </View>
            ) : null}
          </>
        ) : (
          <ActivityIndicator color="#ffffff" style={{ flex: 1 }} />
        )}
      </View>
    </Modal>
  );
}

function RoundButton({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.round, pressed && { opacity: 0.7 }]}
    >
      <Text style={styles.roundText}>{label}</Text>
    </Pressable>
  );
}

function OverlayCard({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return <View style={[styles.card, { backgroundColor: colors.card }]}>{children}</View>;
}

/** Camera permission refused for good: explain and offer Settings. */
export function PermissionDenied({ onClose, text = CAMERA_DENIED_TEXT }: { onClose: () => void; text?: string }) {
  const { colors } = useTheme();
  return (
    <View testID="camera-denied" style={[styles.denied, { backgroundColor: colors.background }]}>
      <Text accessibilityRole="header" style={[styles.deniedTitle, { color: colors.foreground }]}>
        Camera access is off
      </Text>
      <Text style={{ color: colors.mutedForeground, fontSize: 15, textAlign: 'center' }}>{text}</Text>
      <Button title="Open settings" onPress={() => void Linking.openSettings()} testID="camera-open-settings" />
      <Button title="Close" variant="ghost" onPress={onClose} testID="camera-denied-close" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  top: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  hint: { position: 'absolute', left: 24, right: 24, color: '#ffffff', textAlign: 'center', fontSize: 15 },
  shutter: { width: 76, height: 76, borderRadius: 38, borderWidth: 5, borderColor: '#ffffff', backgroundColor: 'rgba(255,255,255,0.3)' },
  round: { backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 22, minHeight: 44, justifyContent: 'center' },
  roundText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end', paddingHorizontal: 12 },
  card: { borderRadius: 16, padding: 20, gap: 12, maxHeight: '80%' },
  denied: { flex: 1, justifyContent: 'center', padding: 24, gap: 16 },
  deniedTitle: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
});
