import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateInviteResponse,
  CreateTechnicianInput,
  ListTechniciansQuery,
  Paginated,
  TechnicianDto,
  UpdateTechnicianInput,
} from '@champ/shared';
import { api } from '@/lib/api';
import { usersKeys } from '../users/queries';

export const techniciansKeys = {
  all: ['technicians'] as const,
  list: (query: Partial<ListTechniciansQuery>) => ['technicians', 'list', query] as const,
};

export function useTechnicians(query: Partial<ListTechniciansQuery>) {
  return useQuery({
    queryKey: techniciansKeys.list(query),
    queryFn: () => api<Paginated<TechnicianDto>>('/technicians', { query }),
    placeholderData: keepPreviousData,
  });
}

export function useCreateTechnician() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTechnicianInput) =>
      api<CreateInviteResponse>('/technicians', { method: 'POST', body: input }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: usersKeys.invites }),
  });
}

export function useUpdateTechnician(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateTechnicianInput) =>
      api<TechnicianDto>(`/technicians/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: techniciansKeys.all });
      void queryClient.invalidateQueries({ queryKey: usersKeys.all });
    },
  });
}
