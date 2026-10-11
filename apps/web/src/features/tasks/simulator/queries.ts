import { useMutation } from '@tanstack/react-query';
import type { SimulateInput, TransitionResponse } from '@champ/shared';
import { api } from '@/lib/api';
import { useInvalidateTasks } from '../queries';

/**
 * `POST /dev/fitments/:fid/simulate`: the dev-only technician simulator (D-073). Kept next to the panel so
 * it is only ever loaded through the panel's lazy import (never in a production bundle).
 */
export function useSimulateTechnician() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: ({ fitmentId, body }: { fitmentId: string; body: SimulateInput }) =>
      api<TransitionResponse>(`/dev/fitments/${fitmentId}/simulate`, { method: 'POST', body }),
    onSuccess: invalidate,
  });
}
