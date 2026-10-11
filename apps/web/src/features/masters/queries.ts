import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ListResponse, LookupsResponse } from '@champ/shared';
import { api } from '@/lib/api';
import type { MasterConfig, MasterRow } from './config';

export const lookupsKey = ['lookups'] as const;

export const mastersKeys = {
  all: ['masters'] as const,
  list: (slug: string, query: Record<string, string | undefined>) => ['masters', slug, query] as const,
};

/** All active master values (`GET /lookups`). Cached for long; master edits invalidate it. */
export function useLookups() {
  return useQuery({
    queryKey: lookupsKey,
    queryFn: () => api<LookupsResponse>('/lookups'),
    staleTime: 10 * 60_000,
  });
}

export function useMasterList(config: MasterConfig, query: Record<string, string | undefined>) {
  return useQuery({
    queryKey: mastersKeys.list(config.slug, query),
    queryFn: async () => (await api<ListResponse<MasterRow>>(config.endpoint, { query })).items,
    placeholderData: keepPreviousData,
  });
}

/** Create (no id) or update (PATCH) a master row; refreshes admin lists and the lookups cache. */
export function useSaveMaster(config: MasterConfig) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Record<string, unknown> }) =>
      id
        ? api<MasterRow>(`${config.endpoint}/${id}`, { method: 'PATCH', body })
        : api<MasterRow>(config.endpoint, { method: 'POST', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mastersKeys.all });
      void queryClient.invalidateQueries({ queryKey: lookupsKey });
    },
  });
}
