import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  FitmentLookupItemDto,
  Paginated,
  TravelAttachmentUploadResponse,
  TravelOptionsResponse,
  TravelTaskDto,
  TravelTaskListItemDto,
  TravelTransitionInput,
} from '@champ/shared';
import { api, apiUploadWithProgress } from '@/lib/api';
import { tasksKeys } from '../tasks/queries';

export const travelKeys = {
  all: ['travel'] as const,
  list: (query: Record<string, string | number>) => ['travel', 'list', query] as const,
  detail: (id: string) => ['travel', 'detail', id] as const,
  options: ['travel', 'options'] as const,
  lookup: (q: string) => ['travel', 'lookup', q] as const,
};

/** Receipt URLs are presigned for 10 minutes; refetching the detail every 8 keeps them valid (as F06 photos). */
const RECEIPT_REFRESH_MS = 8 * 60_000;

export function useTravelList(query: Record<string, string | number>) {
  return useQuery({
    queryKey: travelKeys.list(query),
    queryFn: () => api<Paginated<TravelTaskListItemDto>>('/travel-tasks', { query }),
    placeholderData: keepPreviousData,
  });
}

export function useTravelTask(id: string | null) {
  return useQuery({
    queryKey: travelKeys.detail(id ?? ''),
    queryFn: () => api<TravelTaskDto>(`/travel-tasks/${id}`),
    enabled: !!id,
    refetchOnWindowFocus: true,
    refetchInterval: RECEIPT_REFRESH_MS,
  });
}

/** Technicians the caller may raise for (SA/OM: all active; OE: their own). */
export function useTravelOptions(enabled = true) {
  return useQuery({
    queryKey: travelKeys.options,
    queryFn: () => api<TravelOptionsResponse>('/travel-tasks/options'),
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** `GET /fitments/lookup?q=` for the related-task combobox (only once something is typed). */
export function useFitmentLookup(q: string) {
  const text = q.trim();
  return useQuery({
    queryKey: travelKeys.lookup(text),
    queryFn: () => api<{ items: FitmentLookupItemDto[] }>('/fitments/lookup', { query: { q: text } }),
    enabled: text.length > 0,
    staleTime: 30_000,
  });
}

/** After any travel change: refresh travel lists and details, and the dashboard counts. */
function useInvalidateTravel() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: travelKeys.all });
    void queryClient.invalidateQueries({ queryKey: tasksKeys.summary });
  };
}

function useTravelMutation<V>(mutationFn: (vars: V) => Promise<TravelTaskDto>) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateTravel();
  return useMutation({
    mutationFn,
    onSuccess: (tt) => {
      queryClient.setQueryData(travelKeys.detail(tt.id), tt);
      invalidate();
    },
  });
}

/** The create / edit body as the form sends it (the API validates it again). */
export type TravelBody = Record<string, unknown>;

export const useCreateTravel = () => useTravelMutation((body: TravelBody) => api<TravelTaskDto>('/travel-tasks', { method: 'POST', body }));

export const useUpdateTravel = () =>
  useTravelMutation(({ id, body }: { id: string; body: TravelBody }) => api<TravelTaskDto>(`/travel-tasks/${id}`, { method: 'PATCH', body }));

/** Verify, Reject, Resubmit (optionally with changes) and Reopen. */
export const useTravelTransition = () =>
  useTravelMutation(({ id, body }: { id: string; body: TravelTransitionInput }) =>
    api<TravelTaskDto>(`/travel-tasks/${id}/transitions`, { method: 'POST', body }),
  );

/** Uploads one receipt with progress (0–1). */
export function useUploadReceipt() {
  const invalidate = useInvalidateTravel();
  return useMutation({
    mutationFn: ({ id, file, onProgress }: { id: string; file: File; onProgress?: (fraction: number) => void }) => {
      const form = new FormData();
      form.append('file', file);
      return apiUploadWithProgress<TravelAttachmentUploadResponse>(`/travel-tasks/${id}/attachments`, form, onProgress);
    },
    onSuccess: invalidate,
  });
}

export function useRemoveReceipt() {
  const invalidate = useInvalidateTravel();
  return useMutation({
    mutationFn: ({ id, attachmentId, reason }: { id: string; attachmentId: string; reason?: string }) =>
      api<void>(`/travel-tasks/${id}/attachments/${attachmentId}/remove`, { method: 'POST', body: { reason } }),
    onSuccess: invalidate,
  });
}
