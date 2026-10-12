import {
  missingVerificationFields,
  REOPEN_REASON_MIN,
  verificationFieldMessage,
  type ApproveVisitDetailDto,
  type LookupsResponse,
  type TransitionInput,
} from '@champ/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckBox } from '../components/checkbox';
import { Dialog, OptionList } from '../components/dialog';
import { Field, FitmentFormView } from '../components/fitment-form-view';
import { NoConnection, StateView } from '../components/state-view';
import { StatusBadge } from '../components/status-badge';
import { useToast } from '../components/toast';
import { Button, Card, Muted, TextField } from '../components/ui';
import { api, ApiError, isNetworkError } from '../lib/api-client';
import { approveVisitDetailKey, approveVisitListKey } from '../lib/history';
import { useSelectedDate } from '../lib/selected-date';
import { useTheme } from '../theme/use-theme';
import { fetchApproveVisitList } from './approve-visit-screen';
import { formatIstDateTime } from './fitment-summary-screen';

const messageOf = (e: unknown): string =>
  isNetworkError(e) ? "Can't reach the Champ server. Try again." : e instanceof Error ? e.message : 'Something went wrong.';

interface Fields {
  issueObservedId: string | null;
  actionTakenId: string | null;
  finalIssueId: string | null;
  accessoryIds: string[];
  oeRemarks: string;
}

type Picker = 'none' | 'issueObservedId' | 'actionTakenId' | 'finalIssueId' | 'accessories' | 'reopen';

const fieldsOf = (d: ApproveVisitDetailDto): Fields => ({
  issueObservedId: d.verification.issueObserved?.id ?? null,
  actionTakenId: d.verification.actionTaken?.id ?? null,
  finalIssueId: d.verification.finalIssue?.id ?? null,
  accessoryIds: d.verification.accessories.map((a) => a.id),
  oeRemarks: d.verification.oeRemarks ?? '',
});

/** F12 §5: one submitted fitment — the technician's form read only, the verification fields, Verify and Reopen. */
export function ApproveVisitDetailScreen() {
  const { colors, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { date } = useSelectedDate();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [fields, setFields] = useState<Fields | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [picker, setPicker] = useState<Picker>('none');
  const [errors, setErrors] = useState<string[]>([]);
  const [reason, setReason] = useState('');

  const query = useQuery({
    queryKey: approveVisitDetailKey(id),
    queryFn: () => api<ApproveVisitDetailDto>(`/mobile/approve-visit/${id}`),
  });
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api<LookupsResponse>('/lookups'), staleTime: 5 * 60_000 });
  const d = query.data;
  // Start from what's saved (a draft from the web), once per fitment.
  if (d && loadedFor !== id) {
    setLoadedFor(id);
    setFields(fieldsOf(d));
  }

  const refreshAll = () =>
    Promise.all(
      [['mobile-home'], ['mobile-approve-visit'], ['mobile-history']].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );

  /** After Verify or Reopen: the next waiting fitment, or back to the list when none is left. */
  const openNext = async () => {
    await refreshAll();
    try {
      const list = await queryClient.fetchQuery({ queryKey: approveVisitListKey(date), queryFn: () => fetchApproveVisitList(date), staleTime: 0 });
      const next = list.items.find((i) => i.fitmentId !== id);
      if (next) {
        router.replace({ pathname: '/approve-visit/[id]', params: { id: next.fitmentId } });
        return;
      }
    } catch {
      // Fall back to the list.
    }
    router.back();
  };

  const transition = useMutation({
    mutationFn: (body: TransitionInput) => api<unknown>(`/fitments/${id}/transitions`, { method: 'POST', body }),
    onMutate: () => setErrors([]),
    onSuccess: (_r, body) => {
      setPicker('none');
      toast(`${d?.item.tkId ?? 'Fitment'} ${body.action === 'VERIFY' ? 'verified' : 'reopened'}`);
      void openNext();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) {
        // Someone else verified or reopened it meanwhile.
        setPicker('none');
        toast(e.message);
        void refreshAll();
        router.back();
        return;
      }
      setErrors([messageOf(e)]);
    },
  });

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 8, borderColor: colors.border }]}>
      <Pressable testID="back" accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={12}>
        <Text style={{ color: colors.primary, fontSize: 17, fontWeight: '600' }}>‹ Back</Text>
      </Pressable>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
        {d ? d.item.tkId : 'Approve visit'}
      </Text>
    </View>
  );

  if (query.isError && !d) {
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
  if (!d || !fields) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {header}
        <Muted style={{ padding: 24, textAlign: 'center' }}>Loading…</Muted>
      </View>
    );
  }

  const l = lookups.data;
  const nameOf = (options: { id: string; name: string }[] | undefined, value: string | null) =>
    value ? (options?.find((o) => o.id === value)?.name ?? '…') : 'Choose…';
  const finalIssue = l?.finalIssues.find((o) => o.id === fields.finalIssueId) ?? null;
  const set = (patch: Partial<Fields>) => setFields({ ...fields, ...patch });
  const canVerify = d.availableActions.includes('VERIFY');
  const canReopen = d.availableActions.includes('REOPEN');

  const verify = () => {
    const missing = missingVerificationFields(fields);
    if (missing.length) {
      setErrors(missing.map(verificationFieldMessage));
      return;
    }
    transition.mutate({
      action: 'VERIFY',
      payload: {
        issueObservedId: fields.issueObservedId,
        actionTakenId: fields.actionTakenId,
        finalIssueId: fields.finalIssueId,
        accessoryIds: fields.accessoryIds,
        oeRemarks: fields.oeRemarks.trim() || null,
      },
    });
  };

  const single = (key: 'issueObservedId' | 'actionTakenId' | 'finalIssueId', title: string, options: { id: string; name: string }[]) => (
    <Dialog visible={picker === key} title={title} onClose={() => setPicker('none')} sheet>
      <OptionList
        options={options}
        value={fields[key]}
        onChange={(v) => {
          set({ [key]: v });
          setPicker('none');
        }}
        testIDPrefix={`option-${key}`}
      />
    </Dialog>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {header}
      {/* Padding on Android too (D-177/D-178): edge-to-edge windows don't resize for the keyboard. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Card>
            <View style={styles.rowHead}>
              <Text style={[styles.customer, { color: colors.foreground }]}>{d.item.customer}</Text>
              <StatusBadge status={d.status} />
            </View>
            <Muted>{d.item.site.name}</Muted>
            <Field label="Technician" value={d.item.technician?.name ?? '—'} testID="technician" />
            <Field label="Started at" value={formatIstDateTime(d.startedAt)} testID="started-at" />
            <Field label="Submitted at" value={formatIstDateTime(d.item.submittedAt)} testID="submitted-at" />
          </Card>

          <FitmentFormView form={d.form} isVehicle={d.isVehicle} photos={d.photos} />

          <Card testID="verification">
            <Text style={[styles.section, { color: colors.foreground }]}>Verification</Text>
            {d.verification.otRemarks ? <Field label="Technician remarks" value={d.verification.otRemarks} /> : null}
            {lookups.isError ? <Text style={{ color: colors.destructive }}>{messageOf(lookups.error)}</Text> : null}
            <SelectRow label="Issue observed" value={nameOf(l?.issuesObserved, fields.issueObservedId)} testID="pick-issueObservedId" onPress={() => setPicker('issueObservedId')} />
            <SelectRow label="Action taken" value={nameOf(l?.actionsTaken, fields.actionTakenId)} testID="pick-actionTakenId" onPress={() => setPicker('actionTakenId')} />
            <SelectRow
              label="Final issue"
              value={nameOf(l?.finalIssues, fields.finalIssueId)}
              hint={finalIssue ? (finalIssue.billable ? 'Billable' : 'Not billable') : undefined}
              testID="pick-finalIssueId"
              onPress={() => setPicker('finalIssueId')}
            />
            <SelectRow
              label="Accessories"
              value={
                fields.accessoryIds.length
                  ? fields.accessoryIds.map((a) => l?.accessories.find((o) => o.id === a)?.name ?? '…').join(', ')
                  : 'None'
              }
              testID="pick-accessories"
              onPress={() => setPicker('accessories')}
            />
            <TextField
              label="OE remarks"
              testID="oe-remarks"
              value={fields.oeRemarks}
              onChangeText={(t) => set({ oeRemarks: t })}
              maxLength={1000}
              multiline
            />
          </Card>
          {!canVerify && !canReopen ? <Muted style={{ textAlign: 'center' }}>Nothing to do on this fitment</Muted> : null}
        </ScrollView>

        {canVerify || canReopen ? (
          <View style={[styles.footer, { paddingBottom: insets.bottom + 12, borderColor: colors.border, backgroundColor: colors.background }]}>
            {errors.length && picker !== 'reopen' ? (
              <View testID="verify-errors">
                {errors.map((e) => (
                  <Text key={e} style={{ color: colors.destructive }}>
                    {e}
                  </Text>
                ))}
              </View>
            ) : null}
            <View style={styles.actions}>
              {canReopen ? (
                <View style={{ flex: 1 }}>
                  <Button title="Reopen" variant="ghost" testID="reopen" onPress={() => setPicker('reopen')} disabled={transition.isPending} />
                </View>
              ) : null}
              {canVerify ? (
                <View style={{ flex: 1 }}>
                  <Button title="Verify" testID="verify" onPress={verify} loading={transition.isPending && transition.variables?.action === 'VERIFY'} />
                </View>
              ) : null}
            </View>
          </View>
        ) : null}
      </KeyboardAvoidingView>

      {single('issueObservedId', 'Issue observed', l?.issuesObserved ?? [])}
      {single('actionTakenId', 'Action taken', l?.actionsTaken ?? [])}
      {single(
        'finalIssueId',
        'Final issue',
        (l?.finalIssues ?? []).map((o) => ({ id: o.id, name: `${o.name} · ${o.billable ? 'Billable' : 'Not billable'}` })),
      )}

      <Dialog visible={picker === 'accessories'} title="Accessories" onClose={() => setPicker('none')} sheet>
        <View style={{ gap: 6 }}>
          {(l?.accessories ?? []).map((o) => {
            const checked = fields.accessoryIds.includes(o.id);
            return (
              <Pressable
                key={o.id}
                testID={`accessory-${o.id}`}
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                onPress={() => set({ accessoryIds: checked ? fields.accessoryIds.filter((a) => a !== o.id) : [...fields.accessoryIds, o.id] })}
                style={[
                  styles.option,
                  { borderRadius: radius, borderColor: checked ? colors.primary : colors.border },
                  checked && { backgroundColor: colors.brandSoft },
                ]}
              >
                <CheckBox checked={checked} testID={`accessory-box-${o.id}`} />
                <Text style={{ flex: 1, color: checked ? colors.brandSoftForeground : colors.foreground, fontSize: 16 }}>{o.name}</Text>
              </Pressable>
            );
          })}
        </View>
        <Button title="Done" testID="accessories-done" onPress={() => setPicker('none')} />
      </Dialog>

      <Dialog visible={picker === 'reopen'} title={`Reopen ${d.item.tkId}?`} onClose={() => setPicker('none')} testID="reopen-dialog">
        <Muted>The technician will be asked to correct and submit it again.</Muted>
        <TextField label="Reason" testID="reopen-reason" value={reason} onChangeText={setReason} maxLength={500} multiline />
        {errors.length && picker === 'reopen' ? <Text style={{ color: colors.destructive }}>{errors.join('\n')}</Text> : null}
        <Button
          title="Reopen"
          variant="destructive"
          testID="reopen-confirm"
          disabled={reason.trim().length < REOPEN_REASON_MIN}
          loading={transition.isPending}
          onPress={() => transition.mutate({ action: 'REOPEN', payload: { reason: reason.trim() } })}
        />
        <Button title="Cancel" variant="ghost" onPress={() => setPicker('none')} />
      </Dialog>
    </View>
  );
}

function SelectRow({ label, value, hint, testID, onPress }: { label: string; value: string; hint?: string; testID: string; onPress: () => void }) {
  const { colors, radius } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: '500' }}>{label}</Text>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}`}
        onPress={onPress}
        style={[styles.select, { borderColor: colors.input, borderRadius: radius }]}
      >
        <Text style={{ color: colors.foreground, fontSize: 16, flex: 1 }}>{value}</Text>
        <Text style={{ color: colors.mutedForeground }}>▾</Text>
      </Pressable>
      {hint ? <Muted>{hint}</Muted> : null}
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
  select: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, minHeight: 48, paddingHorizontal: 12 },
  footer: { paddingHorizontal: 16, paddingTop: 12, gap: 8, borderTopWidth: StyleSheet.hairlineWidth },
  actions: { flexDirection: 'row', gap: 8 },
  option: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
});
