import { useQuery } from '@tanstack/react-query';
import type { InviteDto, ListUsersQuery, ManagersQuery, Paginated, UserDto, UserRef } from '@champ/shared';
import { api } from '@/lib/api';

export const usersKeys = {
  all: ['users'] as const,
  list: (query: Partial<ListUsersQuery>) => ['users', 'list', query] as const,
  managers: (role: ManagersQuery['role']) => ['users', 'managers', role] as const,
  invites: ['invites'] as const,
};

export function useUsers(query: Partial<ListUsersQuery>) {
  return useQuery({
    queryKey: usersKeys.list(query),
    queryFn: () => api<Paginated<UserDto>>('/users', { query }),
    placeholderData: (prev) => prev,
  });
}

/** Candidate managers for a user with `role` (empty when the role has no manager). */
export function useManagerCandidates(role: string | undefined, enabled = true) {
  const managedRole = role === 'OT' || role === 'OE' || role === 'RO' ? role : undefined;
  return useQuery({
    queryKey: usersKeys.managers(managedRole ?? 'OT'),
    queryFn: async () => (await api<{ items: UserRef[] }>('/users/managers', { query: { role: managedRole } })).items,
    enabled: enabled && !!managedRole,
  });
}

export function useInvites(enabled = true) {
  return useQuery({
    queryKey: usersKeys.invites,
    queryFn: async () => (await api<{ items: InviteDto[] }>('/invites')).items,
    enabled,
  });
}
