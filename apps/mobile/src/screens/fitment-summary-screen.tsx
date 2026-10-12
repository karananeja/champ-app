import { IST_TIME_ZONE, type MyFitmentDto } from '@champ/shared';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Field, FitmentFormView } from '../components/fitment-form-view';
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

/** F10B §5 / M16: what was submitted, with Edit until the OE verifies. */
export function FitmentSummaryScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

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

  const verified = f.status === 'OE_VERIFIED' || f.status === 'OM_APPROVED';

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
          <Field label="Started at" value={formatIstDateTime(f.startedAt)} testID="started-at" />
          <Field label="Submitted at" value={formatIstDateTime(f.submittedAt)} testID="submitted-at" />
        </Card>

        <FitmentFormView form={f.form} isVehicle={f.isVehicle} photos={f.photos} />

        {f.status === 'SUBMITTED' ? (
          <Button title="Edit" testID="edit" onPress={() => router.push({ pathname: '/fitment/[id]/continue', params: { id } })} />
        ) : null}
        {verified ? <Muted style={{ textAlign: 'center' }}>{VERIFIED_READ_ONLY}</Muted> : null}
        <Button title="Back to route" variant="ghost" testID="back-to-route" onPress={() => router.dismissTo('/route')} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { flex: 1, fontSize: 20, fontWeight: '700' },
  content: { padding: 16, gap: 12 },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  customer: { fontSize: 18, fontWeight: '700', flexShrink: 1 },
});
