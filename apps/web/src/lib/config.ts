import { useQuery } from '@tanstack/react-query';
import type { ConfigResponse } from '@champ/shared';
import { api } from './api';

/** Public runtime config (e.g. whether Google sign-in is enabled). */
export function useAppConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: () => api<ConfigResponse>('/config'),
    staleTime: Infinity,
  });
}
