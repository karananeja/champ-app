import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { GlobalSearchResponse, SearchIdentifier, SearchIdentifierSettingDto } from '@champ/shared';
import { api, withQuery } from '@/lib/api';

export const searchKeys = {
  all: ['search'] as const,
  results: (q: string, limit?: number) => ['search', 'results', q, limit ?? null] as const,
  identifiers: ['search', 'identifiers'] as const,
};

/** GET /search (F14); fetched only for a searchable query (see `isSearchable`). */
export const useGlobalSearch = (q: string, { limit, enabled = true }: { limit?: number; enabled?: boolean } = {}) =>
  useQuery({
    queryKey: searchKeys.results(q, limit),
    queryFn: () => api<GlobalSearchResponse>(withQuery('/search', { q, limit })),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

/** The search identifiers in ranking order (SA settings). */
export const useSearchIdentifiers = () =>
  useQuery({ queryKey: searchKeys.identifiers, queryFn: () => api<SearchIdentifierSettingDto[]>('/search/identifiers') });

export function useUpdateSearchIdentifiers() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (items: { identifier: SearchIdentifier; enabled: boolean }[]) =>
      api<SearchIdentifierSettingDto[]>('/search/identifiers', { method: 'PUT', body: { items } }),
    onSuccess: (saved) => {
      client.setQueryData(searchKeys.identifiers, saved);
      // Cached results may now include or miss an identifier.
      void client.removeQueries({ queryKey: ['search', 'results'] });
      toast.success('Search identifiers saved');
    },
  });
}
