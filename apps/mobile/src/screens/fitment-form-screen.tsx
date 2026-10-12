import {
  CHECK_LABELS,
  CHECK_VALUES,
  DEVICE_REPLACEMENT_LABELS,
  DEVICE_REPLACEMENTS,
  FITMENT_CHECKS,
  FITMENT_FORM_FIELD_LABELS,
  FORM_COMMENTS_MAX,
  CLUSTER_READING_MAX,
  PHOTO_SLOT_LABELS,
  missingForSubmit,
  placementLabel,
  requiredPhotoKinds,
  type CheckValue,
  type DeviceReplacement,
  type FitmentCheck,
  type FitmentFormDto,
  type FitmentFormInput,
  type FitmentPhotoDto,
  type MyFitmentDto,
  type RequiredPhotoKind,
} from '@champ/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Dialog } from '../components/dialog';
import { PhotoSlot } from '../components/photo-slot';
import { ScanField } from '../components/scan-field';
import { NoConnection, StateView } from '../components/state-view';
import { Button, Card, Muted, TextField } from '../components/ui';
import { ApiError, api, isNetworkError } from '../lib/api-client';
import { fitmentQueryKey } from '../lib/route';
import { useTheme } from '../theme/use-theme';

export const SAVE_RETRY_MS = 5000;
export const NOT_SAVED_RETRYING = 'Not saved — retrying';
export const SAVE_BEFORE_SUBMIT_FAILED = "Your latest answers aren't saved yet. Check your connection and try again.";

/** Fitment statuses in which the technician may edit (D-184). */
export const isFormEditable = (status: MyFitmentDto['status']): boolean => status === 'IN_PROGRESS' || status === 'SUBMITTED';

const CHECK_SHORT: Record<CheckValue, string> = { OK: 'OK', NOT_OK: 'Not OK', NA: 'N/A' };

type Section = RequiredPhotoKind | 'checks' | 'vehicle' | 'replacement' | 'device' | 'comments';

/** Which section a missing-list label scrolls to. */
function sectionFor(label: string): Section {
  for (const [kind, l] of Object.entries(PHOTO_SLOT_LABELS)) if (l === label) return kind as RequiredPhotoKind;
  if (label === placementLabel('DEVICE') || label === placementLabel('SIM')) return 'PLACEMENT';
  if ((Object.values(CHECK_LABELS) as string[]).includes(label)) return 'checks';
  if (label === FITMENT_FORM_FIELD_LABELS.vehicleRegNo || label === FITMENT_FORM_FIELD_LABELS.clusterReadingKm) return 'vehicle';
  if (label === FITMENT_FORM_FIELD_LABELS.deviceReplacement) return 'replacement';
  if (label === FITMENT_FORM_FIELD_LABELS.deviceId) return 'device';
  return 'checks';
}

type SaveStatus = 'saved' | 'saving' | 'error';

/**
 * The autosave queue: one PUT at a time; patches made while one is in flight are merged and sent next. A failure
 * keeps the patch and retries every SAVE_RETRY_MS while the screen is open. `flush()` resolves once everything is
 * saved, or rejects on the next failure.
 */
function useSaveQueue(id: string, onSaved: (f: MyFitmentDto) => void) {
  const [status, setStatus] = useState<SaveStatus>('saved');
  const pending = useRef<FitmentFormInput | null>(null);
  const inFlight = useRef(false);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waiters = useRef<{ resolve: () => void; reject: (e: unknown) => void }[]>([]);
  const mounted = useRef(true);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (retry.current) clearTimeout(retry.current);
    };
  }, []);

  const pump = useCallback(async (): Promise<void> => {
    if (inFlight.current || !mounted.current) return;
    if (retry.current) {
      clearTimeout(retry.current);
      retry.current = null;
    }
    const body = pending.current;
    if (!body) {
      setStatus('saved');
      const ws = waiters.current.splice(0);
      ws.forEach((w) => w.resolve());
      return;
    }
    pending.current = null;
    inFlight.current = true;
    setStatus('saving');
    try {
      const saved = await api<MyFitmentDto>(`/mobile/fitments/${id}/form`, { method: 'PUT', body });
      inFlight.current = false;
      if (!mounted.current) return;
      onSavedRef.current(saved);
      await pump();
    } catch (e) {
      inFlight.current = false;
      // Keep the failed patch, under anything newer.
      pending.current = mergePatch(body, pending.current);
      if (!mounted.current) return;
      setStatus('error');
      const ws = waiters.current.splice(0);
      ws.forEach((w) => w.reject(e));
      retry.current = setTimeout(() => void pump(), SAVE_RETRY_MS);
    }
  }, [id]);

  const save = useCallback(
    (patch: FitmentFormInput) => {
      pending.current = mergePatch(pending.current, patch);
      void pump();
    },
    [pump],
  );

  const flush = useCallback(
    () =>
      new Promise<void>((resolve, reject) => {
        waiters.current.push({ resolve, reject });
        void pump();
      }),
    [pump],
  );

  return { status, save, flush };
}

function mergePatch(a: FitmentFormInput | null, b: FitmentFormInput | null): FitmentFormInput | null {
  if (!a) return b;
  if (!b) return a;
  return { ...a, ...b, ...(a.checks || b.checks ? { checks: { ...a.checks, ...b.checks } } : {}) };
}

interface Draft {
  vehicleRegNo: string;
  chassisNo: string;
  clusterReadingKm: string;
  deviceId: string;
  secondaryDeviceId: string;
  comments: string;
  deviceReplacement: DeviceReplacement | null;
  checks: Partial<Record<FitmentCheck, CheckValue>>;
}

type TextKey = 'vehicleRegNo' | 'chassisNo' | 'clusterReadingKm' | 'deviceId' | 'secondaryDeviceId' | 'comments';

function draftOf(f: MyFitmentDto): Draft {
  const form: FitmentFormDto = f.form;
  return {
    // Pre-filled from the task when the form has nothing yet (intent §1).
    vehicleRegNo: form.vehicleRegNo ?? f.vehicleRegNo ?? '',
    chassisNo: form.chassisNo ?? f.chassisNo ?? '',
    clusterReadingKm: form.clusterReadingKm === null ? '' : String(form.clusterReadingKm),
    deviceId: form.deviceId ?? '',
    secondaryDeviceId: form.secondaryDeviceId ?? '',
    comments: form.comments ?? '',
    deviceReplacement: form.deviceReplacement,
    checks: { ...form.checks },
  };
}

/** Validates one text field; returns the value to send or an error message. */
function parseField(key: TextKey, raw: string): { value: string | number | null } | { error: string } {
  const v = raw.trim();
  if (key === 'clusterReadingKm') {
    if (v === '') return { value: null };
    if (!/^\d+$/.test(v)) return { error: 'Enter whole kilometres' };
    const n = Number(v);
    if (n > CLUSTER_READING_MAX) return { error: `The reading must be at most ${CLUSTER_READING_MAX.toLocaleString('en-IN')} km` };
    return { value: n };
  }
  const max = key === 'comments' ? FORM_COMMENTS_MAX : key === 'deviceId' || key === 'secondaryDeviceId' ? 64 : 32;
  if (v.length > max) return { error: `${FITMENT_FORM_FIELD_LABELS[key]} must be at most ${max} characters` };
  if (v === '') return { value: null };
  return { value: key === 'deviceId' || key === 'secondaryDeviceId' ? v.toUpperCase() : v };
}

const messageOf = (e: unknown): string =>
  isNetworkError(e) ? "Can't reach the Champ server. Try again." : e instanceof Error ? e.message : 'Something went wrong.';

/** F10B §5: the fitment form (route `/fitment/[id]/continue`). */
export function FitmentFormScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();

  const query = useQuery({
    queryKey: fitmentQueryKey(id),
    queryFn: () => api<MyFitmentDto>(`/mobile/fitments/${id}`),
  });
  const f = query.data;

  const [draft, setDraft] = useState<Draft | null>(null);
  const [photos, setPhotos] = useState<Partial<Record<RequiredPhotoKind, FitmentPhotoDto>>>({});
  const [errors, setErrors] = useState<Partial<Record<TextKey, string>>>({});
  const [missing, setMissing] = useState<string[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);
  const sectionY = useRef<Partial<Record<Section, number>>>({});

  // Initialise the local draft once, when the fitment first loads; later refetches don't overwrite typing.
  if (f && draft === null) {
    setDraft(draftOf(f));
    const active: Partial<Record<RequiredPhotoKind, FitmentPhotoDto>> = {};
    for (const p of f.photos) if (p.kind !== 'DEBUG') active[p.kind] = p;
    setPhotos(active);
  }

  const recordY = useCallback((s: Section, y: number) => {
    sectionY.current[s] = y;
  }, []);

  const queue = useSaveQueue(id, (saved) => queryClient.setQueryData(fitmentQueryKey(id), saved));

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 8, borderColor: colors.border }]}>
      <Pressable testID="back" accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={12}>
        <Text style={{ color: colors.primary, fontSize: 17, fontWeight: '600' }}>‹ Back</Text>
      </Pressable>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
        {f?.tkId ?? 'Fitment form'}
      </Text>
      {f ? (
        <Text testID="save-status" style={{ color: queue.status === 'error' ? colors.destructive : colors.mutedForeground, fontSize: 14 }}>
          {queue.status === 'saving' ? 'Saving…' : queue.status === 'error' ? 'Not saved' : 'Saved'}
        </Text>
      ) : null}
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
  if (!f || !draft) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {header}
        <Muted style={{ padding: 24, textAlign: 'center' }}>Loading…</Muted>
      </View>
    );
  }

  const editable = isFormEditable(f.status);
  const submitted = f.status === 'SUBMITTED';
  const required = requiredPhotoKinds({ isVehicle: f.isVehicle, deviceReplacement: draft.deviceReplacement });

  const setText = (key: TextKey, value: string) => {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };
  const blurText = (key: TextKey) => {
    const parsed = parseField(key, draft[key]);
    if ('error' in parsed) {
      setErrors((e) => ({ ...e, [key]: parsed.error }));
      return;
    }
    queue.save({ [key]: parsed.value } as FitmentFormInput);
  };
  const setCheck = (c: FitmentCheck, v: CheckValue) => {
    setDraft((d) => (d ? { ...d, checks: { ...d.checks, [c]: v } } : d));
    queue.save({ checks: { [c]: v } });
  };
  const setReplacement = (r: DeviceReplacement) => {
    setDraft((d) => (d ? { ...d, deviceReplacement: r } : d));
    queue.save({ deviceReplacement: r });
  };
  const onUploaded = (photo: FitmentPhotoDto) => {
    if (photo.kind !== 'DEBUG') setPhotos((p) => ({ ...p, [photo.kind]: photo }));
    void queryClient.invalidateQueries({ queryKey: fitmentQueryKey(id) });
  };

  /** The whole draft as one PUT body (sent before SUBMIT so nothing typed but not blurred is lost). */
  const fullBody = (): FitmentFormInput | null => {
    const body: Record<string, unknown> = { checks: draft.checks, deviceReplacement: draft.deviceReplacement };
    const nextErrors: Partial<Record<TextKey, string>> = {};
    for (const key of ['vehicleRegNo', 'chassisNo', 'clusterReadingKm', 'deviceId', 'secondaryDeviceId', 'comments'] as const) {
      const parsed = parseField(key, draft[key]);
      if ('error' in parsed) nextErrors[key] = parsed.error;
      else body[key] = parsed.value;
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length ? null : (body as FitmentFormInput);
  };

  const localMissing = (): string[] => {
    const v = (key: TextKey) => {
      const p = parseField(key, draft[key]);
      return 'value' in p ? p.value : null;
    };
    return missingForSubmit(
      {
        vehicleRegNo: v('vehicleRegNo') as string | null,
        clusterReadingKm: v('clusterReadingKm') as number | null,
        deviceReplacement: draft.deviceReplacement,
        deviceId: v('deviceId') as string | null,
        checks: draft.checks,
      },
      Object.keys(photos) as RequiredPhotoKind[],
      { isVehicle: f.isVehicle },
    );
  };

  const goToSummary = () => router.replace({ pathname: '/fitment/[id]/summary', params: { id } });

  const submit = async () => {
    setSubmitError(null);
    const body = fullBody();
    if (!body) return;
    const stillNeeded = submitted ? [] : localMissing();
    if (stillNeeded.length) return setMissing(stillNeeded);
    setSubmitting(true);
    try {
      queue.save(body);
      await queue.flush();
    } catch {
      setSubmitting(false);
      return setSubmitError(SAVE_BEFORE_SUBMIT_FAILED);
    }
    if (!submitted) {
      try {
        await api<unknown>(`/fitments/${id}/transitions`, { method: 'POST', body: { action: 'SUBMIT' } });
      } catch (e) {
        setSubmitting(false);
        const list = e instanceof ApiError && e.code === 'FORM_INCOMPLETE' ? (e.details as { missing?: unknown } | undefined)?.missing : undefined;
        if (Array.isArray(list)) return setMissing(list.map(String));
        return setSubmitError(messageOf(e));
      }
    }
    setSubmitting(false);
    goToSummary();
    await Promise.all(
      [['mobile-route'], ['mobile-home'], ['mobile-fitments'], fitmentQueryKey(id)].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
  };

  const jumpTo = (label: string) => {
    setMissing(null);
    const y = sectionY.current[sectionFor(label)];
    if (y !== undefined) scroll.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
  };

  const slot = (kind: RequiredPhotoKind, label: string) => (
    <Anchor key={kind} id={kind} onY={recordY}>
      <PhotoSlot
        fitmentId={id}
        tkId={f.tkId}
        kind={kind}
        label={label}
        required={required.includes(kind)}
        photo={photos[kind] ?? null}
        onUploaded={onUploaded}
        disabled={!editable}
        testID={`photo-${kind}`}
      />
    </Anchor>
  );

  const showPlacement = draft.deviceReplacement === 'DEVICE' || draft.deviceReplacement === 'SIM';

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {header}
      {/* Padding on Android too (D-177/D-178): edge-to-edge windows don't resize for the keyboard. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView ref={scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {queue.status === 'error' ? (
            <Text testID="save-error" accessibilityRole="alert" style={{ color: colors.destructive }}>
              {NOT_SAVED_RETRYING}
            </Text>
          ) : null}
          {!editable ? <Muted>Verified by your OE — read only</Muted> : null}

          {slot('BEFORE', PHOTO_SLOT_LABELS.BEFORE)}
          {slot('ASSET', PHOTO_SLOT_LABELS.ASSET)}
          {f.isVehicle ? slot('CLUSTER', PHOTO_SLOT_LABELS.CLUSTER) : null}

          <Anchor id="checks" onY={recordY}>
            <Card>
              <SectionTitle>Checks</SectionTitle>
              {FITMENT_CHECKS.map((c) => (
                <View key={c} style={styles.check}>
                  <Text style={{ color: colors.foreground, fontWeight: '500' }}>{CHECK_LABELS[c]}</Text>
                  <Segmented
                    options={CHECK_VALUES.map((v) => ({ value: v, label: CHECK_SHORT[v] }))}
                    value={draft.checks[c] ?? null}
                    onChange={(v) => setCheck(c, v)}
                    disabled={!editable}
                    testIDPrefix={`check-${c}`}
                  />
                </View>
              ))}
            </Card>
          </Anchor>

          <Anchor id="vehicle" onY={recordY}>
            <Card>
              <SectionTitle>Vehicle</SectionTitle>
              <TextField
                label={f.isVehicle ? 'Vehicle reg no. (required)' : 'Vehicle reg no.'}
                testID="field-vehicleRegNo"
                value={draft.vehicleRegNo}
                onChangeText={(v) => setText('vehicleRegNo', v)}
                onBlur={() => blurText('vehicleRegNo')}
                autoCapitalize="characters"
                editable={editable}
                error={errors.vehicleRegNo}
              />
              <TextField
                label="Chassis no."
                testID="field-chassisNo"
                value={draft.chassisNo}
                onChangeText={(v) => setText('chassisNo', v)}
                onBlur={() => blurText('chassisNo')}
                autoCapitalize="characters"
                editable={editable}
                error={errors.chassisNo}
              />
              <TextField
                label={f.isVehicle ? 'Cluster reading, km (required)' : 'Cluster reading, km'}
                testID="field-clusterReadingKm"
                value={draft.clusterReadingKm}
                onChangeText={(v) => setText('clusterReadingKm', v)}
                onBlur={() => blurText('clusterReadingKm')}
                keyboardType="number-pad"
                editable={editable}
                error={errors.clusterReadingKm}
              />
            </Card>
          </Anchor>

          <Anchor id="replacement" onY={recordY}>
            <Card>
              <SectionTitle>Device replacement</SectionTitle>
              <Segmented
                options={DEVICE_REPLACEMENTS.map((r) => ({ value: r, label: DEVICE_REPLACEMENT_LABELS[r] }))}
                value={draft.deviceReplacement}
                onChange={setReplacement}
                disabled={!editable}
                testIDPrefix="replacement"
              />
            </Card>
          </Anchor>

          <Anchor id="device" onY={recordY}>
            <Card>
              <SectionTitle>Device</SectionTitle>
              <ScanField
                label="Device id"
                value={draft.deviceId}
                onChange={(v) => setText('deviceId', v)}
                onBlur={() => blurText('deviceId')}
                required
                error={errors.deviceId}
                disabled={!editable}
                testID="field-deviceId"
              />
              <ScanField
                label="Secondary device id"
                value={draft.secondaryDeviceId}
                onChange={(v) => setText('secondaryDeviceId', v)}
                onBlur={() => blurText('secondaryDeviceId')}
                error={errors.secondaryDeviceId}
                disabled={!editable}
                testID="field-secondaryDeviceId"
              />
            </Card>
          </Anchor>

          {showPlacement ? slot('PLACEMENT', placementLabel(draft.deviceReplacement)) : null}
          {slot('AFTER', PHOTO_SLOT_LABELS.AFTER)}

          <Anchor id="comments" onY={recordY}>
            <TextField
              label="Comments"
              testID="field-comments"
              value={draft.comments}
              onChangeText={(v) => setText('comments', v)}
              onBlur={() => blurText('comments')}
              multiline
              editable={editable}
              error={errors.comments}
            />
          </Anchor>
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: insets.bottom + 12, borderColor: colors.border, backgroundColor: colors.background }]}>
          {submitError ? (
            <Text testID="submit-error" accessibilityRole="alert" style={{ color: colors.destructive }}>
              {submitError}
            </Text>
          ) : null}
          {editable ? (
            <Button title={submitted ? 'Save and view summary' : 'Submit'} testID="submit" loading={submitting} onPress={() => void submit()} />
          ) : (
            <Button title="View summary" testID="view-summary" onPress={goToSummary} />
          )}
        </View>
      </KeyboardAvoidingView>

      <Dialog visible={missing !== null} title="Still needed" onClose={() => setMissing(null)} testID="missing-dialog">
        <Muted>Still needed: {missing?.join(', ')}</Muted>
        {missing?.map((label) => (
          <Pressable
            key={label}
            testID={`missing-${label}`}
            accessibilityRole="button"
            onPress={() => jumpTo(label)}
            style={[styles.missingItem, { borderColor: colors.border }]}
          >
            <Text style={{ color: colors.primary, fontSize: 16 }}>{label}</Text>
          </Pressable>
        ))}
        <Button title="OK" variant="ghost" onPress={() => setMissing(null)} />
      </Dialog>
    </View>
  );
}

/** Wraps a form section and reports its y, so the missing list can scroll to it. */
function Anchor({ id, onY, children }: { id: Section; onY: (s: Section, y: number) => void; children: ReactNode }) {
  return <View onLayout={(e) => onY(id, e.nativeEvent.layout.y)}>{children}</View>;
}

function SectionTitle({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: '700' }}>{children}</Text>;
}

/** A segmented single choice: the checks and Device replacement. */
function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled,
  testIDPrefix,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
  disabled?: boolean;
  testIDPrefix: string;
}) {
  const { colors, radius } = useTheme();
  return (
    <View accessibilityRole="radiogroup" style={[styles.segmented, { borderColor: colors.border, borderRadius: radius }]}>
      {options.map((o, i) => {
        const selected = o.value === value;
        const notOk = o.value === 'NOT_OK' && selected;
        return (
          <Pressable
            key={o.value}
            testID={`${testIDPrefix}-${o.value}`}
            accessibilityRole="radio"
            accessibilityLabel={o.label}
            accessibilityState={{ selected, disabled: !!disabled }}
            disabled={disabled}
            onPress={() => {
              if (!selected) onChange(o.value);
            }}
            style={[
              styles.segment,
              i > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
              selected && { backgroundColor: notOk ? colors.destructive : colors.primary },
              disabled && { opacity: 0.6 },
            ]}
          >
            <Text style={{ color: selected ? (notOk ? '#ffffff' : colors.primaryForeground) : colors.foreground, fontWeight: '600' }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { flex: 1, fontSize: 20, fontWeight: '700' },
  content: { padding: 16, gap: 12, paddingBottom: 24 },
  check: { gap: 6, paddingVertical: 4 },
  segmented: { flexDirection: 'row', borderWidth: 1, overflow: 'hidden' },
  segment: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  footer: { paddingHorizontal: 16, paddingTop: 12, gap: 8, borderTopWidth: StyleSheet.hairlineWidth },
  missingItem: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12 },
});
