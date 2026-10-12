import type { FitmentPhotoDto, RequiredPhotoKind } from '@champ/shared';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, isNetworkError } from '../lib/api-client';
import { preparePhoto, uploadAndDiscard, type PreparedPhoto, type SourceImage } from '../lib/photo-pipeline';
import { useTheme } from '../theme/use-theme';
import { CameraModal } from './camera-modal';
import { Dialog } from './dialog';
import { useToast } from './toast';
import { Button } from './ui';

/** While an upload has failed for lack of a connection, it is retried this often (intent: "retry when the connection returns"). */
export const PHOTO_AUTO_RETRY_MS = 10_000;

type Phase = 'idle' | 'preparing' | 'uploading' | 'failed';

/**
 * One photo of the fitment form (F10B §6.1). Empty: the label, "Required", *Take photo* / *Choose from gallery*.
 * Filled: a thumbnail (tap = full screen), *Retake* and the upload state. The photo is stamped and uploaded as soon
 * as it's taken; a failed upload keeps the stamped file for *Retry*.
 */
export function PhotoSlot({
  fitmentId,
  tkId,
  kind,
  label,
  required,
  photo,
  onUploaded,
  disabled,
  testID = `photo-${kind.toLowerCase()}`,
}: {
  fitmentId: string;
  tkId: string;
  kind: RequiredPhotoKind;
  label: string;
  required: boolean;
  photo: FitmentPhotoDto | null;
  onUploaded: (photo: FitmentPhotoDto) => void;
  disabled?: boolean;
  testID?: string;
}) {
  const { colors, radius } = useTheme();
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>('idle');
  const [pending, setPending] = useState<PreparedPhoto | null>(null);
  const [offline, setOffline] = useState(false);
  const [camera, setCamera] = useState(false);
  const [chooser, setChooser] = useState(false);
  const [viewer, setViewer] = useState(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const upload = useCallback(
    async (prepared: PreparedPhoto) => {
      setPhase('uploading');
      try {
        const dto = await uploadAndDiscard(fitmentId, kind, prepared);
        if (!mounted.current) return;
        setPending(null);
        setPhase('idle');
        setOffline(false);
        onUploaded(dto);
      } catch (e) {
        if (!mounted.current) return;
        setPhase('failed');
        setOffline(isNetworkError(e));
        if (e instanceof ApiError) toast(e.message);
      }
    },
    [fitmentId, kind, onUploaded, toast],
  );

  const process = useCallback(
    async (source: SourceImage) => {
      setPhase('preparing');
      let prepared: PreparedPhoto;
      try {
        prepared = await preparePhoto(source, { tkId });
      } catch {
        if (!mounted.current) return;
        setPhase(pending ? 'failed' : 'idle');
        toast('Could not process the photo. Try again.');
        return;
      }
      if (!mounted.current) return;
      setPending(prepared);
      await upload(prepared);
    },
    [tkId, upload, toast, pending],
  );

  // No connection: keep retrying while the screen is open.
  useEffect(() => {
    if (phase !== 'failed' || !offline || !pending) return;
    const t = setTimeout(() => void upload(pending), PHOTO_AUTO_RETRY_MS);
    return () => clearTimeout(t);
  }, [phase, offline, pending, upload]);

  const pickFromGallery = async () => {
    setChooser(false);
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, allowsEditing: false });
    const asset = res.canceled ? undefined : res.assets?.[0];
    if (asset) await process({ uri: asset.uri, width: asset.width, height: asset.height });
  };

  const openCamera = () => {
    setChooser(false);
    setCamera(true);
  };

  const busy = phase === 'preparing' || phase === 'uploading';
  const thumb = pending?.uri ?? photo?.url ?? null;
  const filled = thumb != null;

  return (
    <View testID={testID} style={[styles.slot, { borderColor: colors.border, borderRadius: radius + 4, backgroundColor: colors.card }]}>
      <View style={styles.header}>
        <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
        {required && !photo ? <Text style={{ color: colors.destructive, fontSize: 13, fontWeight: '600' }}>Required</Text> : null}
      </View>

      {filled ? (
        <View style={styles.filled}>
          <Pressable
            testID={`${testID}-thumb`}
            accessibilityRole="imagebutton"
            accessibilityLabel={`${label}, open full screen`}
            onPress={() => setViewer(true)}
          >
            <Image source={{ uri: thumb }} style={[styles.thumb, { borderRadius: radius, backgroundColor: colors.muted }]} />
          </Pressable>
          <View style={styles.filledSide}>
            {phase === 'preparing' ? <Status text="Preparing…" testID={`${testID}-status`} /> : null}
            {phase === 'uploading' ? <Status text="Uploading…" testID={`${testID}-status`} /> : null}
            {phase === 'failed' ? (
              <>
                <Status text="Upload failed" tone="error" testID={`${testID}-status`} />
                <Button title="Retry" onPress={() => pending && void upload(pending)} testID={`${testID}-retry`} />
              </>
            ) : null}
            {!disabled && !busy ? (
              <Button title="Retake" variant="ghost" onPress={() => setChooser(true)} testID={`${testID}-retake`} />
            ) : null}
          </View>
        </View>
      ) : disabled ? (
        <Text style={{ color: colors.mutedForeground }}>No photo</Text>
      ) : busy ? (
        <Status text="Preparing…" testID={`${testID}-status`} />
      ) : (
        <View style={styles.actions}>
          <Button title="Take photo" onPress={openCamera} testID={`${testID}-take`} />
          <Button title="Choose from gallery" variant="ghost" onPress={() => void pickFromGallery()} testID={`${testID}-gallery`} />
        </View>
      )}

      <Dialog visible={chooser} title={`Retake ${label.toLowerCase()}`} onClose={() => setChooser(false)} sheet testID={`${testID}-chooser`}>
        <Button title="Take photo" onPress={openCamera} testID={`${testID}-chooser-take`} />
        <Button title="Choose from gallery" variant="ghost" onPress={() => void pickFromGallery()} testID={`${testID}-chooser-gallery`} />
        <Button title="Cancel" variant="ghost" onPress={() => setChooser(false)} />
      </Dialog>

      <CameraModal
        visible={camera}
        mode="photo"
        onClose={() => setCamera(false)}
        onPicture={(pic) => {
          setCamera(false);
          void process(pic);
        }}
        testID={`${testID}-camera`}
      />

      {thumb ? <FullScreenImage visible={viewer} uri={thumb} label={label} onClose={() => setViewer(false)} /> : null}
    </View>
  );
}

function Status({ text, tone, testID }: { text: string; tone?: 'error'; testID?: string }) {
  const { colors } = useTheme();
  return (
    <Text testID={testID} style={{ color: tone === 'error' ? colors.destructive : colors.mutedForeground, fontSize: 14 }}>
      {text}
    </Text>
  );
}

/** Tap a thumbnail: the photo on black, tap anywhere to close. */
export function FullScreenImage({ visible, uri, label, onClose }: { visible: boolean; uri: string; label: string; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="fade" presentationStyle="fullScreen" onRequestClose={onClose}>
      <Pressable testID="photo-viewer" accessibilityLabel="Close photo" onPress={onClose} style={styles.viewer}>
        <Image source={{ uri }} style={styles.viewerImage} resizeMode="contain" accessibilityLabel={label} />
        <Text style={[styles.viewerClose, { top: insets.top + 12 }]}>Close</Text>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  slot: { borderWidth: 1, padding: 12, gap: 10 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 16, fontWeight: '600' },
  actions: { gap: 8 },
  filled: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  filledSide: { flex: 1, gap: 8 },
  thumb: { width: 96, height: 96 },
  viewer: { flex: 1, backgroundColor: '#000000', justifyContent: 'center' },
  viewerImage: { width: '100%', height: '100%' },
  viewerClose: { position: 'absolute', right: 20, color: '#ffffff', fontSize: 16, fontWeight: '600' },
});
