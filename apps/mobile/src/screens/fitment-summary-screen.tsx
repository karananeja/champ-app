import {
  CHECK_LABELS,
  CHECK_VALUE_LABELS,
  DEVICE_REPLACEMENT_LABELS,
  FITMENT_CHECKS,
  IST_TIME_ZONE,
  PHOTO_SLOT_LABELS,
  placementLabel,
  requiredPhotoKinds,
  type FitmentPhotoDto,
  type MyFitmentDto,
  type RequiredPhotoKind,
} from '@champ/shared';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NoConnection, StateView } from '../components/state-view';
import { StatusBadge } from '../components/status-badge';
import { Button, Card, Muted } from '../components/ui';
import { api, isNetworkError } from '../lib/api-client';
import { fitmentQueryKey } from '../lib/route';
import { useTheme } from '../theme/use-theme';

/** Submitted or later: the summary is the place to look (F10B §5). */
export const hasSummary = (status: MyFitmentDto['status']): boolean =>
  status === 'SUBMITTED' || status === 'OE_VERIFIED' || status === 'OM_APPROVED';

export const VERIFIED_READ_ONLY = 'Verified by your OE — read only';

const dateTime = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
  timeZone: IST_TIME_ZONE,
});
/** UTC ISO → "12 Oct, 05:04 pm IST"; '—' when absent. */
export const formatIstDateTime = (iso: string | null): string => (iso ? `${dateTime.format(new Date(iso))} IST` : '—');

const PHOTO_ORDER: RequiredPhotoKind[] = ['BEFORE', 'ASSET', 'CLUSTER', 'PLACEMENT', 'AFTER'];

/** F10B §5 / M16: what was submitted, with Edit until the OE verifies. */
export function FitmentSummaryScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [viewing, setViewing] = useState<FitmentPhotoDto | null>(null);

  const query = useQuery({
    queryKey: fitmentQueryKey(id),
    queryFn: () => api<MyFitmentDto>(`/mobile/fitments/${id}`),
  });
  const f = query.data;

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 8, borderColor: colors.border }]}>
      <Pressable testID="back" accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={12}>
        <Text style={{ color: colors.primary, fontSize: 17, fontWeight: '600' }}>‹ Back</Text>
      </Pressable>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
        {f ? `${f.tkId} summary` : 'Summary'}
      </Text>
    </View>
  );

  if (query.isError && !f) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {header}
        {isNetworkError(query.error) ? (
          <NoConnection onRetry={() => void query.refetch()} />
        ) : (
          <StateView illustration="server-error" title="Couldn't load the fitment" message={query.error.message} actionLabel="Retry" onAction={() => void query.refetch()} />
        )}
      </View>
    );
  }
  if (!f) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {header}
        <Muted style={{ padding: 24, textAlign: 'center' }}>Loading…</Muted>
      </View>
    );
  }

  const form = f.form;
  const r = form.deviceReplacement;
  const verified = f.status === 'OE_VERIFIED' || f.status === 'OM_APPROVED';
  const kinds = requiredPhotoKinds({ isVehicle: f.isVehicle, deviceReplacement: r });
  const photoOf = (k: RequiredPhotoKind) => f.photos.find((p) => p.kind === k) ?? null;
  // Show every photo there is, plus empty spots for the required ones.
  const shownKinds = PHOTO_ORDER.filter((k) => kinds.includes(k) || photoOf(k));

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {header}
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        <Card>
          <View style={styles.rowHead}>
            <Text style={[styles.customer, { color: colors.foreground }]}>{f.customer}</Text>
            <StatusBadge status={f.status} />
          </View>
          <Muted>{f.site.name}</Muted>
          <Field label="Started" value={formatIstDateTime(f.startedAt)} testID="started-at" />
          <Field label="Submitted" value={formatIstDateTime(f.submittedAt)} testID="submitted-at" />
        </Card>

        <Card testID="summary-checks">
          <Text style={[styles.section, { color: colors.foreground }]}>Checks</Text>
          {FITMENT_CHECKS.map((c) => {
            const v = form.checks[c];
            return (
              <Field
                key={c}
                label={CHECK_LABELS[c]}
                value={v ? CHECK_VALUE_LABELS[v] : '—'}
                testID={`summary-check-${c}`}
                danger={v === 'NOT_OK'}
              />
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

        {f.status === 'SUBMITTED' ? (
          <Button title="Edit" testID="edit" onPress={() => router.push({ pathname: '/fitment/[id]/continue', params: { id } })} />
        ) : null}
        {verified ? <Muted style={{ textAlign: 'center' }}>{VERIFIED_READ_ONLY}</Muted> : null}
        <Button title="Back to route" variant="ghost" testID="back-to-route" onPress={() => router.dismissTo('/route')} />
      </ScrollView>

      <Modal visible={viewing !== null} animationType="fade" onRequestClose={() => setViewing(null)}>
        <Pressable testID="photo-viewer" accessibilityLabel="Close photo" style={styles.viewer} onPress={() => setViewing(null)}>
          {viewing ? <Image source={{ uri: viewing.url }} style={styles.full} resizeMode="contain" /> : null}
        </Pressable>
      </Modal>
    </View>
  );
}

function Field({ label, value, testID, danger }: { label: string; value: string; testID?: string; danger?: boolean }) {
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
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { flex: 1, fontSize: 20, fontWeight: '700' },
  content: { padding: 16, gap: 12 },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  customer: { fontSize: 18, fontWeight: '700', flexShrink: 1 },
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
