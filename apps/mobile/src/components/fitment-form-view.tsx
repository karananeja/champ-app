import {
  CHECK_LABELS,
  CHECK_VALUE_LABELS,
  DEVICE_REPLACEMENT_LABELS,
  FITMENT_CHECKS,
  PHOTO_SLOT_LABELS,
  placementLabel,
  requiredPhotoKinds,
  type FitmentFormDto,
  type FitmentPhotoDto,
  type RequiredPhotoKind,
} from '@champ/shared';
import { useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/use-theme';
import { Card, Muted } from './ui';

const PHOTO_ORDER: RequiredPhotoKind[] = ['BEFORE', 'ASSET', 'CLUSTER', 'PLACEMENT', 'AFTER'];

/** The technician's answers, read only: checks, details, photos (tap → full screen) and comments (F10B summary, F12 Approve visit). */
export function FitmentFormView({ form, isVehicle, photos }: { form: FitmentFormDto; isVehicle: boolean; photos: FitmentPhotoDto[] }) {
  const { colors } = useTheme();
  const [viewing, setViewing] = useState<FitmentPhotoDto | null>(null);
  const r = form.deviceReplacement;
  const kinds = requiredPhotoKinds({ isVehicle, deviceReplacement: r });
  const photoOf = (k: RequiredPhotoKind) => photos.find((p) => p.kind === k) ?? null;
  // Show every photo there is, plus empty spots for the required ones.
  const shownKinds = PHOTO_ORDER.filter((k) => kinds.includes(k) || photoOf(k));

  return (
    <>
      <Card testID="summary-checks">
        <Text style={[styles.section, { color: colors.foreground }]}>Checks</Text>
        {FITMENT_CHECKS.map((c) => {
          const v = form.checks[c];
          return (
            <Field key={c} label={CHECK_LABELS[c]} value={v ? CHECK_VALUE_LABELS[v] : '—'} testID={`summary-check-${c}`} danger={v === 'NOT_OK'} />
          );
        })}
      </Card>

      <Card>
        <Field label="Vehicle reg no." value={form.vehicleRegNo ?? '—'} testID="summary-vehicleRegNo" />
        <Field label="Chassis no." value={form.chassisNo ?? '—'} testID="summary-chassisNo" />
        <Field
          label="Cluster reading"
          value={form.clusterReadingKm === null ? '—' : `${form.clusterReadingKm.toLocaleString('en-IN')} km`}
          testID="summary-clusterReadingKm"
        />
        <Field label="Device replacement" value={r ? DEVICE_REPLACEMENT_LABELS[r] : '—'} testID="summary-deviceReplacement" />
        <Field label="Device id" value={form.deviceId ?? '—'} testID="summary-deviceId" />
        <Field label="Secondary device id" value={form.secondaryDeviceId ?? '—'} testID="summary-secondaryDeviceId" />
      </Card>

      <Card>
        <Text style={[styles.section, { color: colors.foreground }]}>Photos</Text>
        <View style={styles.photos}>
          {shownKinds.map((k) => {
            const p = photoOf(k);
            const label = k === 'PLACEMENT' ? placementLabel(r) : PHOTO_SLOT_LABELS[k];
            return (
              <View key={k} style={styles.photo}>
                {p ? (
                  <Pressable testID={`thumb-${k}`} accessibilityRole="imagebutton" accessibilityLabel={label} onPress={() => setViewing(p)}>
                    <Image source={{ uri: p.url }} style={[styles.thumb, { backgroundColor: colors.muted }]} />
                  </Pressable>
                ) : (
                  <View style={[styles.thumb, styles.noPhoto, { backgroundColor: colors.muted }]}>
                    <Muted>No photo</Muted>
                  </View>
                )}
                <Muted style={{ fontSize: 12 }}>{label}</Muted>
              </View>
            );
          })}
        </View>
      </Card>

      <Card>
        <Text style={[styles.section, { color: colors.foreground }]}>Comments</Text>
        <Text testID="summary-comments" style={{ color: colors.foreground }}>
          {form.comments ?? '—'}
        </Text>
      </Card>

      <Modal visible={viewing !== null} animationType="fade" onRequestClose={() => setViewing(null)}>
        <Pressable testID="photo-viewer" accessibilityLabel="Close photo" style={styles.viewer} onPress={() => setViewing(null)}>
          {viewing ? <Image source={{ uri: viewing.url }} style={styles.full} resizeMode="contain" /> : null}
        </Pressable>
      </Modal>
    </>
  );
}

export function Field({ label, value, testID, danger }: { label: string; value: string; testID?: string; danger?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      <Muted style={styles.fieldLabel}>{label}</Muted>
      <Text testID={testID} style={[styles.fieldValue, { color: danger ? colors.destructive : colors.foreground }, danger && { fontWeight: '700' }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 16, fontWeight: '700' },
  field: { flexDirection: 'row', gap: 12, paddingVertical: 2 },
  fieldLabel: { width: 150 },
  fieldValue: { flex: 1, fontSize: 15 },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  photo: { width: 96, gap: 4 },
  thumb: { width: 96, height: 96, borderRadius: 8 },
  noPhoto: { alignItems: 'center', justifyContent: 'center' },
  viewer: { flex: 1, backgroundColor: '#000000', justifyContent: 'center' },
  full: { width: '100%', height: '100%' },
});
