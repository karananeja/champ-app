import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { DelegationInput, UserDto } from '@champ/shared';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ApiError, api } from '@/lib/api';
import { usersKeys } from './queries';

interface Props {
  user: UserDto | null;
  onOpenChange: (open: boolean) => void;
}

/** SA only: delegate user management and task-type management to an OM. */
export function DelegationDialog({ user, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (input: DelegationInput) =>
      api<UserDto>(`/users/${user!.id}/delegation`, { method: 'PATCH', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: usersKeys.all });
      toast.success('Delegation updated');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Could not update delegation'),
  });

  // Optimistic view of the flags while the mutation is in flight.
  const pending = mutation.isPending ? mutation.variables : undefined;
  const canManageUsers = pending?.canManageUsers ?? user?.canManageUsers ?? false;
  const canManageTaskTypes = pending?.canManageTaskTypes ?? user?.canManageTaskTypes ?? false;

  return (
    <Dialog open={!!user} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delegation</DialogTitle>
          <DialogDescription>Extra permissions for {user?.name}.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="delegate-users" className="grid grid-cols-1 gap-1">
              <span>Delegate user management</span>
              <span className="text-sm font-normal text-muted-foreground">Change roles, managers and status.</span>
            </Label>
            <Switch
              id="delegate-users"
              checked={canManageUsers}
              disabled={mutation.isPending}
              onCheckedChange={(checked) => mutation.mutate({ canManageUsers: checked })}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="delegate-task-types" className="grid grid-cols-1 gap-1">
              <span>Delegate task types</span>
              <span className="text-sm font-normal text-muted-foreground">Manage task types (available from F02).</span>
            </Label>
            <Switch
              id="delegate-task-types"
              checked={canManageTaskTypes}
              disabled={mutation.isPending}
              onCheckedChange={(checked) => mutation.mutate({ canManageTaskTypes: checked })}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
