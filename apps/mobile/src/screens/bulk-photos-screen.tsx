import type { BulkFillTaskDto, FitmentPhotoDto } from '@champ/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PhotoSlot } from '../components/photo-slot';
import { NoConnection, StateView } from '../components/state-view';
import { Button, Muted } from '../components/ui';
import { api, isNetworkError } from '../lib/api-client';
import { BULK_STALE_KEYS, bulkFillPath, bulkFillQueryKey, photoSteps, type PhotoStep } from '../lib/bulk-fill';
import { useTheme } from '../theme/use-theme';

export const START_FIRST_NOTE = 'Start it first (Confirm a CSV or Start)';

/**
 * F11 §5 *Add photos*: one missing photo at a time, across the task's fitments in order (before → asset → cluster →
 * placement → after). The steps are fixed when the screen opens, so uploads don't reshuffle them.
 */
export function BulkPhotosScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  const query = useQuery({
    queryKey: bulkFillQueryKey(taskId),
    queryFn: () => api<BulkFillTaskDto>(bulkFillPath(taskId)),
  });
  const [plan, setPlan] = useState<{ steps: PhotoStep[]; skipped: string[] } | null>(null);
  const [index, setIndex] = useState(0);
  const [uploaded, setUploaded] = useState<FitmentPhotoDto | null>(null);

  if (query.data && !plan) setPlan(photoSteps(query.data));

  const finish = () => {
    for (const queryKey of BULK_STALE_KEYS) void queryClient.invalidateQueries({ queryKey: [...queryKey] });
    router.back();
  };
  const advance = () => {
    setUploaded(null);
    if (plan && index + 1 < plan.steps.length) setIndex(index + 1);
    else finish();
  };

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 8, borderColor: colors.border }]}>
      <Pressable testID="back" accessibilityRole="button" accessibilityLabel="Back" onPress={finish} hitSlop={12}>
        <Text style={{ color: colors.primary, fontSize: 17, fontWeight: '600' }}>‹ Back</Text>
      </Pressable>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
        Add photos
      </Text>
    </View>
  );

  if (query.isError && !plan) {
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
  if (!plan) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {header}
        <Muted style={{ padding: 24, textAlign: 'center' }}>Loading…</Muted>
      </View>
    );
  }

  const step = plan.steps[index];
  const last = index + 1 >= plan.steps.length;
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {header}
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        {plan.skipped.length > 0 ? (
          <Text testID="skipped-note" style={{ color: colors.mutedForeground }}>
            {plan.skipped.join(', ')}: {START_FIRST_NOTE}
          </Text>
        ) : null}
        {step ? (
          <>
            <Text testID="step-header" style={[styles.step, { color: colors.foreground }]}>
              {step.tkId}
              {step.regNo ? ` · ${step.regNo}` : ''} — {index + 1} of {plan.steps.length}
            </Text>
            <PhotoSlot
              key={`${step.fitmentId}-${step.kind}`}
              fitmentId={step.fitmentId}
              tkId={step.tkId}
              kind={step.kind}
              label={step.label}
              required
              photo={uploaded}
              onUploaded={setUploaded}
            />
            <Button title={last ? 'Done' : 'Next'} testID="next" disabled={!uploaded} onPress={advance} />
            <Button title="Skip" variant="ghost" testID="skip" onPress={advance} />
          </>
        ) : (
          <>
            <Muted>No photos to add.</Muted>
            <Button title="Done" testID="done" onPress={finish} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { flex: 1, fontSize: 20, fontWeight: '700' },
  content: { padding: 16, gap: 12 },
  step: { fontSize: 16, fontWeight: '700' },
});
