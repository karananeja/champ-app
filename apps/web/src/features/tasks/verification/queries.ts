import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  FitmentPhotosResponse,
  FitmentVerificationDto,
  PhotoUploadResponse,
  TransitionResponse,
  UpdateVerificationInput,
} from '@champ/shared';
import { api, apiUploadWithProgress } from '@/lib/api';
import { useInvalidateTasks } from '../queries';

export const photosKeys = {
  all: ['photos'] as const,
  list: (fitmentId: string, history: boolean) => ['photos', fitmentId, history] as const,
};

/** Presigned photo URLs live 10 minutes; refetching every 8 keeps them valid while the page stays open. */
const PHOTO_REFRESH_MS = 8 * 60_000;

/** `GET /fitments/:fid/photos` (with `history`: replaced and removed photos too). */
export function useFitmentPhotos(fitmentId: string, history = false, enabled = true) {
  return useQuery({
    queryKey: photosKeys.list(fitmentId, history),
    queryFn: () => api<FitmentPhotosResponse>(`/fitments/${fitmentId}/photos`, { query: { history: history ? 'true' : undefined } }),
    enabled,
    refetchOnWindowFocus: true,
    refetchInterval: PHOTO_REFRESH_MS,
  });
}

/** After a photo or verification change: refresh photos and every task query (counts, flags, history). */
function useInvalidateAll() {
  const queryClient = useQueryClient();
  const invalidateTasks = useInvalidateTasks();
  return () => {
    void queryClient.invalidateQueries({ queryKey: photosKeys.all });
    invalidateTasks();
  };
}

/** `PUT /fitments/:fid/verification` (Save draft). */
export function useSaveVerification(fitmentId: string) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (body: UpdateVerificationInput) =>
      api<FitmentVerificationDto>(`/fitments/${fitmentId}/verification`, { method: 'PUT', body }),
    onSuccess: invalidate,
  });
}

/** `POST /fitments/:fid/transitions` VERIFY with the verification fields (saved first, same transaction). */
export function useVerifyFitment(fitmentId: string) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (payload: UpdateVerificationInput) =>
      api<TransitionResponse>(`/fitments/${fitmentId}/transitions`, { method: 'POST', body: { action: 'VERIFY', payload } }),
    onSuccess: invalidate,
  });
}

/** `POST /fitments/:fid/photos`: a debug image, with upload progress (0–1). */
export function useUploadDebugPhoto(fitmentId: string) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ file, onProgress }: { file: File; onProgress?: (fraction: number) => void }) => {
      const form = new FormData();
      form.append('kind', 'DEBUG');
      form.append('file', file);
      return apiUploadWithProgress<PhotoUploadResponse>(`/fitments/${fitmentId}/photos`, form, onProgress);
    },
    onSuccess: invalidate,
  });
}

/** `POST /fitments/:fid/photos/:pid/replace`. */
export function useReplacePhoto(fitmentId: string) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ photoId, file, reason, onProgress }: { photoId: string; file: File; reason: string; onProgress?: (fraction: number) => void }) => {
      const form = new FormData();
      form.append('reason', reason);
      form.append('file', file);
      return apiUploadWithProgress<PhotoUploadResponse>(`/fitments/${fitmentId}/photos/${photoId}/replace`, form, onProgress);
    },
    onSuccess: invalidate,
  });
}

/** `POST /fitments/:fid/photos/:pid/remove`. */
export function useRemovePhoto(fitmentId: string) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ photoId, reason }: { photoId: string; reason: string }) =>
      api<void>(`/fitments/${fitmentId}/photos/${photoId}/remove`, { method: 'POST', body: { reason } }),
    onSuccess: invalidate,
  });
}
