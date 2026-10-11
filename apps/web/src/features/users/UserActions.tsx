import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import type { UserDto } from '@champ/shared';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ApiError, api } from '@/lib/api';
import { canEditDelegation, canEditUser } from '@/lib/permissions';
import { usersKeys } from './queries';

interface Props {
  actor: UserDto;
  user: UserDto;
  onEdit: (user: UserDto) => void;
  onDelegation: (user: UserDto) => void;
}

/** Row actions; renders nothing when the actor has no permitted action. */
export function UserActions({ actor, user, onEdit, onDelegation }: Props) {
  const queryClient = useQueryClient();
  const toggleStatus = useMutation({
    mutationFn: () =>
      api<UserDto>(`/users/${user.id}`, {
        method: 'PATCH',
        body: { status: user.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' },
      }),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: usersKeys.all });
      toast.success(`${updated.name} is now ${updated.status.toLowerCase()}`);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Could not update the user'),
  });

  const editable = canEditUser(actor, user);
  const delegation = canEditDelegation(actor, user);
  if (!editable && !delegation) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${user.name}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {editable && (
          <>
            <DropdownMenuItem onSelect={() => onEdit(user)}>Edit role / manager</DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => toggleStatus.mutate()}
              className={user.status === 'ACTIVE' ? 'text-destructive focus:text-destructive' : undefined}
            >
              {user.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
            </DropdownMenuItem>
          </>
        )}
        {editable && delegation && <DropdownMenuSeparator />}
        {delegation && <DropdownMenuItem onSelect={() => onDelegation(user)}>Delegation…</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
