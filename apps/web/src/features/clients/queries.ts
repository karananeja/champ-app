import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ClientDto,
  ClientListItemDto,
  ClientSiteDto,
  CreateClientInput,
  GeoReverseResponse,
  GeoSearchResponse,
  Paginated,
  UpdateClientInput,
  UpdateSiteInput,
} from '@champ/shared';
import { api } from '@/lib/api';
import { lookupsKey } from '../masters/queries';

export const clientsKeys = {
  all: ['clients'] as const,
  list: (query: ClientsListParams) => ['clients', 'list', query] as const,
  detail: (id: string) => ['clients', 'detail', id] as const,
};

/** The request bodies the forms send (raw form values; the API normalises them). */
type ClientBody = Omit<CreateClientInput, 'sites'> & { sites: SiteBody[] };
export type SiteBody = Omit<CreateClientInput['sites'][number], 'lat' | 'lng'> & { lat: number | null; lng: number | null };
export type ClientFieldsBody = Omit<ClientBody, 'sites'>;

/** `GET /clients` query string (see `listClientsQuerySchema`). */
export type ClientsListParams = {
  q?: string;
  active?: 'true' | 'false';
  page?: number;
  pageSize?: number;
};

export function useClients(query: ClientsListParams) {
  return useQuery({
    queryKey: clientsKeys.list(query),
    queryFn: () => api<Paginated<ClientListItemDto>>('/clients', { query }),
    placeholderData: keepPreviousData,
  });
}

export function useClient(id: string | undefined) {
  return useQuery({
    queryKey: clientsKeys.detail(id ?? ''),
    queryFn: () => api<ClientDto>(`/clients/${id}`),
    enabled: !!id,
  });
}

/** Client and site edits refresh the client lists/details and the lookups cache (F04 reads clients from it). */
function useInvalidateClients() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: clientsKeys.all });
    void queryClient.invalidateQueries({ queryKey: lookupsKey });
  };
}

export function useCreateClient() {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: (body: ClientBody) => api<ClientDto>('/clients', { method: 'POST', body }),
    onSuccess: invalidate,
  });
}

export function useUpdateClient(id: string) {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: (body: Partial<ClientFieldsBody> | UpdateClientInput) =>
      api<ClientDto>(`/clients/${id}`, { method: 'PATCH', body }),
    onSuccess: invalidate,
  });
}

export function useAddSite(clientId: string) {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: (body: SiteBody) => api<ClientSiteDto>(`/clients/${clientId}/sites`, { method: 'POST', body }),
    onSuccess: invalidate,
  });
}

export function useUpdateSite(clientId: string) {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: ({ siteId, body }: { siteId: string; body: Partial<SiteBody> | UpdateSiteInput }) =>
      api<ClientSiteDto>(`/clients/${clientId}/sites/${siteId}`, { method: 'PATCH', body }),
    onSuccess: invalidate,
  });
}

// --- Geocoding (proxied by the API, D-054) ---

export const geoKeys = {
  search: (q: string) => ['geo', 'search', q] as const,
};

/** Address search; only runs for 3+ characters. Results are cached for the session. */
export function useGeoSearch(q: string) {
  return useQuery({
    queryKey: geoKeys.search(q),
    queryFn: () => api<GeoSearchResponse>('/geo/search', { query: { q } }),
    enabled: q.length >= 3,
    staleTime: Infinity,
    retry: false,
  });
}

export const reverseGeocode = (lat: number, lng: number) =>
  api<GeoReverseResponse>('/geo/reverse', { query: { lat: lat.toFixed(6), lng: lng.toFixed(6) } });
