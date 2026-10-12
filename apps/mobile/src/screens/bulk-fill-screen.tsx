import type {
  BulkFillConfirmInput,
  BulkFillConfirmResponse,
  BulkFillFitmentDto,
  BulkFillPreviewResponse,
  BulkFillPreviewRow,
  BulkFillTaskDto,
  SubmitReadyResponse,
} from '@champ/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Dialog } from '../components/dialog';
import { NoConnection, StateView } from '../components/state-view';
import { StatusBadge } from '../components/status-badge';
import { useToast } from '../components/toast';
import { Button, Card, Muted } from '../components/ui';
import { api, isNetworkError } from '../lib/api-client';
import {
  BULK_STALE_KEYS,
  bulkFillPath,
  bulkFillQueryKey,
  countsLine,
  CSV_PICKER_TYPES,
  isReadyToSubmit,
  previewCsv,
  progressLine,
  readableFill,
  shareSampleCsv,
} from '../lib/bulk-fill';
import { formatIstTime } from '../lib/format';
import { requireFreshFix } from '../lib/location';
import { TONES } from '../theme/colors';
import { useTheme } from '../theme/use-theme';
import { LOCATION_DENIED_MESSAGE, LOCATION_UNAVAILABLE_MESSAGE } from './fitment-screen';
import { formatIstDateTime } from './fitment-summary-screen';

const messageOf = (e: unknown): string =>
  isNetworkError(e) ? "Can't reach the Champ server. Try again." : e instanceof Error ? e.message : 'Something went wrong.';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "18 ready, 2 with problems · 6 will be started". */
export const previewSummary = (p: BulkFillPreviewResponse): string =>
  `${p.validCount} ready, ${p.invalidCount} with problems${p.startCount > 0 ? ` · ${p.startCount} will be started` : ''}`;

type Dialogs = 'none' | 'location' | 'submit' | 'submit-result' | 'confirm-result';

/** F11 §5: bulk fill for one task — progress per fitment, sample CSV, upload → preview → confirm, photos, Submit ready. */
export function BulkFillScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  const [preview, setPreview] = useState<BulkFillPreviewResponse | null>(null);
  const [dialog, setDialog] = useState<Dialogs>('none');
  const [locationMessage, setLocationMessage] = useState(LOCATION_DENIED_MESSAGE);
  const [locating, setLocating] = useState(false);
  const [confirmResult, setConfirmResult] = useState<BulkFillConfirmResponse | null>(null);
  const [submitResult, setSubmitResult] = useState<SubmitReadyResponse | null>(null);

  const query = useQuery({
    queryKey: bulkFillQueryKey(taskId),
    queryFn: () => api<BulkFillTaskDto>(bulkFillPath(taskId)),
  });
  const task = query.data;

  const invalidateAll = () => Promise.all(BULK_STALE_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey: [...queryKey] })));

  const sample = useMutation({
    mutationFn: () => shareSampleCsv(taskId, task?.omId ?? 'task'),
    onSuccess: (r) => {
      if (!r.shared) toast(`Saved to ${r.uri}`);
    },
    onError: (e) => toast(messageOf(e)),
  });

  const upload = useMutation({
    mutationFn: async () => {
      const picked = await DocumentPicker.getDocumentAsync({ type: CSV_PICKER_TYPES, copyToCacheDirectory: true });
      const file = picked.canceled ? undefined : picked.assets?.[0];
      if (!file) return null;
      return previewCsv(taskId, { uri: file.uri, name: file.name, mimeType: file.mimeType });
    },
    onSuccess: (p) => {
      if (p) setPreview(p);
    },
    onError: (e) => toast(messageOf(e)),
  });

  const confirm = useMutation({
    mutationFn: (body: BulkFillConfirmInput) => api<BulkFillConfirmResponse>(`${bulkFillPath(taskId)}/confirm`, { method: 'POST', body }),
    onSuccess: (r) => {
      setConfirmResult(r);
      setDialog('confirm-result');
    },
    onError: (e) => toast(messageOf(e)),
    onSettled: invalidateAll,
  });

  const submitReady = useMutation({
    mutationFn: () => api<SubmitReadyResponse>(`/mobile/tasks/${encodeURIComponent(taskId)}/submit-ready`, { method: 'POST' }),
    onSuccess: (r) => {
      setSubmitResult(r);
      setDialog('submit-result');
    },
    onError: (e) => {
      setDialog('none');
      toast(messageOf(e));
    },
    onSettled: invalidateAll,
  });

  const confirmPreview = async () => {
    if (!preview) return;
    const rows = preview.rows.filter((r) => r.valid).map((r) => ({ rowNumber: r.rowNumber, tkId: r.tkId, form: r.form }));
    if (rows.length === 0) return;
    // One fix starts every not-yet-started fitment (D-202); without one nothing is sent.
    if (preview.startCount > 0) {
      setLocating(true);
      const result = await requireFreshFix();
      setLocating(false);
      if (!result.ok) {
        setLocationMessage(result.reason === 'denied' ? LOCATION_DENIED_MESSAGE : LOCATION_UNAVAILABLE_MESSAGE);
        setDialog('location');
        return;
      }
      confirm.mutate({ rows, lat: result.fix.lat, lng: result.fix.lng });
    } else {
      confirm.mutate({ rows });
    }
  };

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 8, borderColor: colors.border }]}>
      <Pressable
        testID="back"
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={() => (preview ? setPreview(null) : router.back())}
        hitSlop={12}
      >
        <Text style={{ color: colors.primary, fontSize: 17, fontWeight: '600' }}>‹ Back</Text>
      </Pressable>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
        {preview ? 'Check the CSV' : 'Bulk fill'}
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
          <StateView illustration="server-error" title="Couldn't load the task" message={query.error.message} actionLabel="Retry" onAction={() => void query.refetch()} />
        )}
      </View>
    );
  }
  if (!task) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {header}
        <Muted style={{ padding: 24, textAlign: 'center' }}>Loading…</Muted>
      </View>
    );
  }

  const readyCount = task.fitments.filter(isReadyToSubmit).length;
  const anyMissingPhotos = task.fitments.some((r) => r.missingPhotos.length > 0);

  const dialogs = (
    <>
      <Dialog visible={dialog === 'location'} title="Location required" onClose={() => setDialog('none')} testID="location-dialog">
        <Text style={{ color: colors.foreground }}>{locationMessage}</Text>
        <Button title="Open settings" variant="ghost" testID="open-settings" onPress={() => void Linking.openSettings()} />
        <Button title="OK" onPress={() => setDialog('none')} />
      </Dialog>

      <Dialog visible={dialog === 'confirm-result'} title="CSV applied" onClose={() => setDialog('none')} testID="confirm-result">
        {confirmResult ? <ConfirmResult result={confirmResult} /> : null}
        <Button
          title="Done"
          testID="confirm-result-done"
          onPress={() => {
            setDialog('none');
            setPreview(null);
          }}
        />
      </Dialog>

      <Dialog visible={dialog === 'submit'} title={`Submit ${plural(readyCount, 'fitment')}?`} onClose={() => setDialog('none')} testID="submit-dialog">
        <Muted>Every In-progress fitment of this task with its form and photos complete is sent to your OE.</Muted>
        <Button title="Submit" testID="submit-confirm" loading={submitReady.isPending} onPress={() => submitReady.mutate()} />
        <Button title="Cancel" variant="ghost" onPress={() => setDialog('none')} />
      </Dialog>

      <Dialog visible={dialog === 'submit-result'} title="Submit ready" onClose={() => setDialog('none')} testID="submit-result">
        {submitResult ? <SubmitResult result={submitResult} /> : null}
        <Button title="Done" testID="submit-result-done" onPress={() => setDialog('none')} />
      </Dialog>
    </>
  );

  if (preview) {
    const valid = preview.rows.filter((r) => r.valid);
    const invalid = preview.rows.filter((r) => !r.valid);
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {header}
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
          <Text testID="preview-summary" style={[styles.counts, { color: colors.foreground }]}>
            {previewSummary(preview)}
          </Text>
          {valid.map((r) => (
            <PreviewRow key={r.rowNumber} row={r} />
          ))}
          {invalid.map((r) => (
            <PreviewRow key={r.rowNumber} row={r} />
          ))}
          <Button
            title={`Confirm (${valid.length})`}
            testID="confirm"
            disabled={valid.length === 0}
            loading={locating || confirm.isPending}
            onPress={() => void confirmPreview()}
          />
          <Button title="Cancel" variant="ghost" testID="cancel-preview" onPress={() => setPreview(null)} />
        </ScrollView>
        {dialogs}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {header}
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        <Card>
          <Text style={[styles.customer, { color: colors.foreground }]}>
            {task.omId} · {task.customer}
          </Text>
          <Text style={{ color: colors.foreground }}>{task.site.name}</Text>
          <Muted>{formatIstDateTime(task.fitmentAt)}</Muted>
          <Text testID="counts" style={[styles.counts, { color: colors.foreground }]}>
            {countsLine(task)}
          </Text>
        </Card>

        <Button title="Download sample CSV" variant="ghost" testID="download-sample" loading={sample.isPending} onPress={() => sample.mutate()} />
        <Button title="Upload CSV" testID="upload-csv" loading={upload.isPending} onPress={() => upload.mutate()} />
        {anyMissingPhotos ? (
          <Button
            title="Add photos"
            variant="ghost"
            testID="add-photos"
            onPress={() => router.push({ pathname: '/task/[taskId]/photos', params: { taskId } })}
          />
        ) : null}
        {readyCount > 0 ? <Button title={`Submit ready (${readyCount})`} testID="submit-ready" onPress={() => setDialog('submit')} /> : null}

        {task.fitments.map((r) => (
          <FitmentRow key={r.fitment.id} row={r} onOpen={() => router.push({ pathname: '/fitment/[id]', params: { id: r.fitment.id } })} />
        ))}
      </ScrollView>
      {dialogs}
    </View>
  );
}

function FitmentRow({ row, onOpen }: { row: BulkFillFitmentDto; onOpen: () => void }) {
  const { colors, radius } = useTheme();
  const f = row.fitment;
  return (
    <Pressable
      testID={`bulk-row-${f.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${f.tkId}, open`}
      onPress={onOpen}
      style={[styles.row, { borderColor: colors.border, backgroundColor: colors.card, borderRadius: radius + 4 }]}
    >
      <View style={styles.rowHead}>
        <Text style={[styles.tk, { color: colors.foreground }]}>{f.tkId}</Text>
        <StatusBadge status={f.status} />
      </View>
      <Muted>
        {f.form.vehicleRegNo ?? f.vehicleRegNo ?? 'No reg no.'} · {formatIstTime(f.fitmentAt)} IST
      </Muted>
      <Text testID={`progress-${f.id}`} style={[styles.small, { color: colors.foreground }]}>
        {progressLine(row)}
      </Text>
      {row.missing.length > 0 ? (
        <Text testID={`missing-${f.id}`} style={[styles.smaller, { color: colors.mutedForeground }]}>
          Missing: {row.missing.join(', ')}
        </Text>
      ) : null}
    </Pressable>
  );
}

function PreviewRow({ row }: { row: BulkFillPreviewRow }) {
  const { colors, radius, dark } = useTheme();
  const tone = TONES[row.valid ? 'emerald' : 'red'][dark ? 'dark' : 'light'];
  const fill = readableFill(row.form);
  return (
    <View
      testID={`preview-row-${row.rowNumber}`}
      style={[styles.row, { borderColor: tone.border, borderLeftColor: tone.text, borderLeftWidth: 4, backgroundColor: tone.bg, borderRadius: radius + 4 }]}
    >
      <View style={styles.rowHead}>
        <Text style={[styles.tk, { color: colors.foreground }]}>{row.valid ? row.tkId : `Row ${row.rowNumber} · ${row.tkId || 'no TK id'}`}</Text>
        {row.willStart ? (
          <Text testID={`will-start-${row.rowNumber}`} style={[styles.tag, { color: colors.primary }]}>
            Will be started
          </Text>
        ) : null}
      </View>
      {row.valid
        ? fill.map(([label, value]) => (
            <Text key={label} style={[styles.small, { color: colors.foreground }]}>
              {label}: {value}
            </Text>
          ))
        : row.errors.map((e, i) => (
            <Text key={i} style={[styles.small, { color: colors.destructive }]}>
              {e.column ? `${e.column}: ` : ''}
              {e.message}
            </Text>
          ))}
      {row.valid && fill.length === 0 ? <Muted>Nothing to fill</Muted> : null}
    </View>
  );
}

function ConfirmResult({ result }: { result: BulkFillConfirmResponse }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text testID="filled-count" style={{ color: colors.foreground }}>
        Filled {plural(result.filled.length, 'fitment')}
        {result.filled.length ? `: ${result.filled.join(', ')}` : ''}
      </Text>
      {result.started.length ? (
        <Text style={{ color: colors.foreground }}>
          Started {plural(result.started.length, 'fitment')}: {result.started.join(', ')}
        </Text>
      ) : null}
      {result.failed.map((f) => (
        <Text key={`${f.rowNumber}-${f.tkId}`} style={{ color: colors.destructive }}>
          Row {f.rowNumber} · {f.tkId}: {f.message}
        </Text>
      ))}
    </View>
  );
}

function SubmitResult({ result }: { result: SubmitReadyResponse }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text testID="submitted-list" style={{ color: colors.foreground }}>
        Submitted {plural(result.submitted.length, 'fitment')}
        {result.submitted.length ? `: ${result.submitted.join(', ')}` : ''}
      </Text>
      {result.incomplete.map((i) => (
        <Text key={i.tkId} style={{ color: colors.destructive }}>
          {i.tkId} — still needed: {i.missing.join(', ')}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { flex: 1, fontSize: 20, fontWeight: '700' },
  content: { padding: 16, gap: 12 },
  customer: { fontSize: 18, fontWeight: '700' },
  counts: { fontSize: 15, fontWeight: '600', marginTop: 4 },
  row: { borderWidth: 1, padding: 12, gap: 3 },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  tk: { fontSize: 16, fontWeight: '700', flexShrink: 1 },
  tag: { fontSize: 13, fontWeight: '700' },
  small: { fontSize: 14 },
  smaller: { fontSize: 13 },
});
