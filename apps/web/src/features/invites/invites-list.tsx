import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { InviteDto, UserDto } from '@champ/shared';
import { ListSkeleton, ListStates } from '@/components/list-states';
import { RoleBadge } from '@/components/role-badge';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ApiError, api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useInvites, usersKeys } from '../users/queries';

export function InvitesList({ actor }: { actor: UserDto }) {
  const queryClient = useQueryClient();
  const { data: invites, isPending, isError, error, refetch } = useInvites();
  const revoke = useMutation({
    mutationFn: (id: string) => api<InviteDto>(`/invites/${id}/revoke`, { method: 'POST' }),
    onSuccess: (invite) => {
      void queryClient.invalidateQueries({ queryKey: usersKeys.invites });
      toast.success(`Invite for ${invite.email} revoked`);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Could not revoke the invite'),
  });

  if (isPending || isError || invites.length === 0) {
    return (
      <ListStates
        isPending={isPending}
        isError={isError}
        error={error}
        onRetry={() => void refetch()}
        isEmpty
        skeleton={<ListSkeleton rows={3} />}
        empty={{
          illustration: 'invite-error',
          title: 'No invites yet',
          description: 'Invite links you create show here until they are used, revoked or expire.',
        }}
      >
        {null}
      </ListStates>
    );
  }

  const revokeButton = (invite: InviteDto) =>
    invite.status === 'PENDING' && (actor.role === 'SUPER_ADMIN' || invite.invitedBy.id === actor.id) ? (
      <Button variant="outline" size="sm" disabled={revoke.isPending} onClick={() => revoke.mutate(invite.id)}>
        Revoke
      </Button>
    ) : null;

  return (
    <>
      <div className="hidden rounded-md border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Manager</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Expires</TableHead>
              {actor.role === 'SUPER_ADMIN' && <TableHead>Invited by</TableHead>}
              <TableHead className="w-24">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invites.map((invite) => (
              <TableRow key={invite.id} data-testid="invite-row">
                <TableCell className="font-medium break-all whitespace-normal">{invite.email}</TableCell>
                <TableCell>
                  <RoleBadge role={invite.role} />
                </TableCell>
                <TableCell className="whitespace-normal">{invite.manager?.name ?? '—'}</TableCell>
                <TableCell>
                  <StatusBadge status={invite.status} />
                </TableCell>
                <TableCell>{formatDateTime(invite.expiresAt)}</TableCell>
                {actor.role === 'SUPER_ADMIN' && <TableCell className="whitespace-normal">{invite.invitedBy.name}</TableCell>}
                <TableCell>{revokeButton(invite)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="grid grid-cols-1 gap-2 md:hidden">
        {invites.map((invite) => (
          <li key={invite.id} className="rounded-md border p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 truncate font-medium">{invite.email}</div>
              {revokeButton(invite)}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <RoleBadge role={invite.role} />
              <StatusBadge status={invite.status} />
              <span>Expires {formatDateTime(invite.expiresAt)}</span>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
