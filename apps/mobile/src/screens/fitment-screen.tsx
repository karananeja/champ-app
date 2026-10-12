import type { DayRouteDto, LookupsResponse, MyFitmentDto, RouteStopDto, TransitionInput } from '@champ/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Dialog, OptionList } from '../components/dialog';
import { SiteMap } from '../components/route-map';
import { NoConnection, StateView } from '../components/state-view';
import { StatusBadge } from '../components/status-badge';
import { useToast } from '../components/toast';
import { Button, Card, Muted, TextField } from '../components/ui';
import { api, isNetworkError } from '../lib/api-client';
import { formatIstTime } from '../lib/format';
import { requireFreshFix } from '../lib/location';
import { directionsUrls, fitmentQueryKey } from '../lib/route';
import { useTheme } from '../theme/use-theme';
import { hasSummary } from './fitment-summary-screen';

export const LOCATION_DENIED_MESSAGE =
  'Starting a fitment records where you are, so Champ needs your location. Allow location access for Champ in Settings, then try again.';
export const LOCATION_UNAVAILABLE_MESSAGE =
  "Champ couldn't get your current location. Make sure location (GPS) is on and you have a clear view of the sky, then try again.";
export const FAULTY_TOAST = 'Moved to FT — your OE will arrange a replacement';
const FAULTY_REASON_MAX = 500;

/** Every cached route stop for this fitment (the route screen loaded it), to know `isNext` and `blockedBy`. */
function cachedStop(client: QueryClient, id: string): RouteStopDto | null {
  for (const [, route] of client.getQueriesData<DayRouteDto>({ queryKey: ['mobile-route'] })) {
    const stop = route?.stops.find((s) => s.fitment.id === id);
    if (stop) return stop;
  }
  return null;
}

const messageOf = (e: unknown): string =>
  isNetworkError(e) ? "Can't reach the Champ server. Try again." : e instanceof Error ? e.message : 'Something went wrong.';

type Dialogs = 'none' | 'location' | 'continue' | 'close' | 'faulty';

/** F10 §5: one of my fitments, with Directions, Start, Continue-or-Close, Close and Mark faulty. */
export function FitmentScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { id, start } = useLocalSearchParams<{ id: string; start?: string }>();
  const [dialog, setDialog] = useState<Dialogs>('none');
  const [locationMessage, setLocationMessage] = useState(LOCATION_DENIED_MESSAGE);
  const [actionError, setActionError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const autoStarted = useRef(false);
  const [askedOnOpen, setAskedOnOpen] = useState(false);

  const query = useQuery({
    queryKey: fitmentQueryKey(id),
    queryFn: () => api<MyFitmentDto>(`/mobile/fitments/${id}`),
  });
  const stop = cachedStop(queryClient, id);
  // Without a cached route (e.g. a deep link) the server still enforces the order (409 ROUTE_ORDER).
  const isNext = stop ? stop.isNext : true;

  const transition = useMutation({
    mutationFn: (body: TransitionInput) => api<unknown>(`/fitments/${id}/transitions`, { method: 'POST', body }),
    onMutate: () => setActionError(null),
    onSettled: () =>
      Promise.all(
        [['mobile-route'], ['mobile-home'], ['mobile-fitments'], fitmentQueryKey(id)].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      ),
  });

  const f = query.data;

  const startFitment = async () => {
    setActionError(null);
    setLocating(true);
    const result = await requireFreshFix();
    setLocating(false);
    if (!result.ok) {
      setLocationMessage(result.reason === 'denied' ? LOCATION_DENIED_MESSAGE : LOCATION_UNAVAILABLE_MESSAGE);
      setDialog('location');
      return;
    }
    transition.mutate(
      { action: 'START', payload: { lat: result.fix.lat, lng: result.fix.lng } },
      { onSuccess: () => setDialog('continue'), onError: (e) => setActionError(messageOf(e)) },
    );
  };

  // Opening an In-progress fitment asks Continue or Close (once, when it first loads).
  if (f && !askedOnOpen) {
    setAskedOnOpen(true);
    if (f.status === 'IN_PROGRESS') setDialog('continue');
  }
  // The route's Start shortcut starts straight away.
  useEffect(() => {
    if (!f || autoStarted.current) return;
    autoStarted.current = true;
    if (start === '1' && f.status !== 'IN_PROGRESS' && f.availableActions.includes('START')) {
      // Deferred: the flow updates state, which shouldn't happen synchronously inside the effect.
      void Promise.resolve().then(startFitment);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the fitment first loads
  }, [f]);

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 8, borderColor: colors.border }]}>
      <Pressable testID="back" accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={12}>
        <Text style={{ color: colors.primary, fontSize: 17, fontWeight: '600' }}>‹ Back</Text>
      </Pressable>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
        {f?.tkId ?? 'Fitment'}
      </Text>
    </View>
  );

  if (query.isError) {
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

  const can = (a: 'START' | 'CLOSE_NOT_DONE' | 'MARK_FAULTY') => f.availableActions.includes(a);
  const { lat, lng } = f.site;
  const openDirections = () => {
    if (lat === null || lng === null) return;
    const [first, fallback] = directionsUrls(lat, lng, f.site.name);
    Linking.openURL(first as string).catch(() => (fallback ? Linking.openURL(fallback) : undefined));
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {header}
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        {lat !== null && lng !== null ? <SiteMap lat={lat} lng={lng} /> : null}
        <Card>
          <View style={styles.rowHead}>
            <Text style={[styles.customer, { color: colors.foreground }]}>{f.customer}</Text>
            <StatusBadge status={f.status} />
          </View>
          <Text style={{ color: colors.foreground }}>{f.site.name}</Text>
          {f.site.address ? <Muted>{f.site.address}</Muted> : null}
          {lat !== null && lng !== null ? <Button title="Directions" variant="ghost" testID="directions" onPress={openDirections} /> : null}
        </Card>
        <Card>
          <Field label="Fitment time" value={`${formatIstTime(f.fitmentAt)} IST`} />
          <Field label="Activity" value={f.activity} />
          <Field label="Asset type" value={f.assetType} />
          <Field label="Installation type" value={f.installationType} />
          <Field label="Vehicle reg no." value={f.vehicleRegNo ?? '—'} />
          <Field label="Chassis no." value={f.chassisNo ?? '—'} />
          <Field label="Asset no." value={f.assetNumber ?? '—'} />
          <Field
            label="OE"
            value={
              f.oe ? (
                <Text style={{ color: colors.foreground }}>
                  {f.oe.name}
                  {f.oe.phone ? (
                    <Text
                      testID="oe-phone"
                      accessibilityRole="link"
                      style={{ color: colors.primary, fontWeight: '600' }}
                      onPress={() => void Linking.openURL(`tel:${f.oe?.phone?.replace(/\s/g, '') ?? ''}`)}
                    >
                      {`  ${f.oe.phone}`}
                    </Text>
                  ) : null}
                </Text>
              ) : (
                '—'
              )
            }
          />
        </Card>

        {actionError ? (
          <Text testID="action-error" accessibilityRole="alert" style={{ color: colors.destructive }}>
            {actionError}
          </Text>
        ) : null}
        {can('START') && isNext ? (
          <Button title="Start" testID="start" loading={locating || (transition.isPending && transition.variables?.action === 'START')} onPress={() => void startFitment()} />
        ) : null}
        {can('START') && !isNext && stop?.blockedBy ? (
          <Muted>
            Up next after {stop.blockedBy}. Finish or close it first.
          </Muted>
        ) : null}
        {f.status === 'IN_PROGRESS' ? (
          <Button title="Open form" testID="open-form" onPress={() => router.push({ pathname: '/fitment/[id]/continue', params: { id } })} />
        ) : null}
        {hasSummary(f.status) ? (
          <Button title="View summary" testID="view-summary" onPress={() => router.push({ pathname: '/fitment/[id]/summary', params: { id } })} />
        ) : null}
        {can('CLOSE_NOT_DONE') ? <Button title="Close (not done)" variant="ghost" testID="close" onPress={() => setDialog('close')} /> : null}
        {can('MARK_FAULTY') ? <Button title="Mark faulty" variant="ghost" testID="mark-faulty" onPress={() => setDialog('faulty')} /> : null}
      </ScrollView>

      <Dialog visible={dialog === 'location'} title="Location required" onClose={() => setDialog('none')} testID="location-dialog">
        <Text style={{ color: colors.foreground }}>{locationMessage}</Text>
        <Button title="Open settings" variant="ghost" testID="open-settings" onPress={() => void Linking.openSettings()} />
        <Button title="OK" onPress={() => setDialog('none')} />
      </Dialog>

      <Dialog visible={dialog === 'continue'} sheet title="Continue with this fitment?" onClose={() => setDialog('none')} testID="continue-sheet">
        <Muted>{f.tkId} is in progress.</Muted>
        <Button
          title="Yes, continue"
          testID="yes-continue"
          onPress={() => {
            setDialog('none');
            router.push({ pathname: '/fitment/[id]/continue', params: { id } });
          }}
        />
        <Button title="No, close" variant="ghost" testID="no-close" onPress={() => setDialog('close')} />
      </Dialog>

      {dialog === 'close' ? (
        <CloseDialog
          pending={transition.isPending}
          onCancel={() => setDialog('none')}
          onSubmit={(payload, onError) =>
            transition.mutate({ action: 'CLOSE_NOT_DONE', payload }, { onSuccess: () => setDialog('none'), onError: (e) => onError(messageOf(e)) })
          }
        />
      ) : null}
      {dialog === 'faulty' ? (
        <FaultyDialog
          pending={transition.isPending}
          onCancel={() => setDialog('none')}
          onSubmit={(reason, onError) =>
            transition.mutate(
              { action: 'MARK_FAULTY', payload: { reason } },
              {
                onSuccess: () => {
                  setDialog('none');
                  toast(FAULTY_TOAST);
                },
                onError: (e) => onError(messageOf(e)),
              },
            )
          }
        />
      ) : null}
    </View>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      <Muted style={styles.fieldLabel}>{label}</Muted>
      {typeof value === 'string' ? <Text style={[styles.fieldValue, { color: colors.foreground }]}>{value}</Text> : <View style={styles.fieldValue}>{value}</View>}
    </View>
  );
}

function CloseDialog({
  pending,
  onCancel,
  onSubmit,
}: {
  pending: boolean;
  onCancel: () => void;
  onSubmit: (payload: { closeReasonId: string; comments: string }, onError: (message: string) => void) => void;
}) {
  const { colors } = useTheme();
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api<LookupsResponse>('/lookups'), staleTime: 5 * 60_000 });
  const [reasonId, setReasonId] = useState<string | null>(null);
  const [comments, setComments] = useState('');
  const [errors, setErrors] = useState<{ reason?: string; comments?: string; server?: string }>({});

  const submit = () => {
    const next: typeof errors = {};
    if (!reasonId) next.reason = 'Choose a close reason';
    if (!comments.trim()) next.comments = 'Add comments';
    else if (comments.trim().length > 1000) next.comments = 'Comments must be at most 1000 characters';
    setErrors(next);
    if (next.reason || next.comments || !reasonId) return;
    onSubmit({ closeReasonId: reasonId, comments: comments.trim() }, (server) => setErrors({ server }));
  };

  return (
    <Dialog visible title="Close fitment (not done)" onClose={onCancel} testID="close-dialog">
      <Text style={{ color: colors.foreground, fontWeight: '500' }}>Reason</Text>
      {lookups.isPending ? <Muted>Loading reasons…</Muted> : null}
      {lookups.isError ? <Text style={{ color: colors.destructive }}>{messageOf(lookups.error)}</Text> : null}
      <OptionList options={lookups.data?.closeReasons ?? []} value={reasonId} onChange={setReasonId} testIDPrefix="close-reason" />
      {errors.reason ? <Text style={{ color: colors.destructive }}>{errors.reason}</Text> : null}
      <TextField label="Comments" testID="close-comments" value={comments} onChangeText={setComments} multiline error={errors.comments} />
      {errors.server ? (
        <Text testID="close-error" accessibilityRole="alert" style={{ color: colors.destructive }}>
          {errors.server}
        </Text>
      ) : null}
      <Button title="Close fitment" variant="destructive" testID="close-submit" loading={pending} onPress={submit} />
      <Button title="Cancel" variant="ghost" onPress={onCancel} />
    </Dialog>
  );
}

function FaultyDialog({
  pending,
  onCancel,
  onSubmit,
}: {
  pending: boolean;
  onCancel: () => void;
  onSubmit: (reason: string, onError: (message: string) => void) => void;
}) {
  const { colors } = useTheme();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const submit = () => {
    const r = reason.trim();
    if (!r) return setError('Give the fault reason');
    if (r.length > FAULTY_REASON_MAX) return setError(`The fault reason must be at most ${FAULTY_REASON_MAX} characters`);
    setError(null);
    setServerError(null);
    onSubmit(r, setServerError);
  };

  return (
    <Dialog visible title="Mark faulty" onClose={onCancel} testID="faulty-dialog">
      <Muted>The fitment moves to FT and your OE arranges a replacement.</Muted>
      <TextField label="Fault reason" testID="faulty-reason" value={reason} onChangeText={setReason} multiline error={error ?? undefined} />
      {serverError ? (
        <Text testID="faulty-error" accessibilityRole="alert" style={{ color: colors.destructive }}>
          {serverError}
        </Text>
      ) : null}
      <Button title="Mark faulty" variant="destructive" testID="faulty-submit" loading={pending} onPress={submit} />
      <Button title="Cancel" variant="ghost" onPress={onCancel} />
    </Dialog>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { flex: 1, fontSize: 20, fontWeight: '700' },
  content: { padding: 16, gap: 12 },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  customer: { fontSize: 18, fontWeight: '700', flexShrink: 1 },
  field: { flexDirection: 'row', gap: 12, paddingVertical: 2 },
  fieldLabel: { width: 130 },
  fieldValue: { flex: 1, fontSize: 15 },
});
