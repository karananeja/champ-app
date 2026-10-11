import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { MANAGER_RULES, ROLE_LABELS, type Role, type UpdateUserInput, type UserDto } from '@champ/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ApiError, api } from '@/lib/api';
import { assignableRoles } from '@/lib/permissions';
import { useManagerCandidates, usersKeys } from './queries';

interface Props {
  actor: UserDto;
  user: UserDto | null;
  onOpenChange: (open: boolean) => void;
}

/** Edit a user's role and manager. */
export function EditUserDialog({ actor, user, onOpenChange }: Props) {
  return (
    <Dialog open={!!user} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {user && <EditUserForm key={user.id} actor={actor} user={user} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function EditUserForm({ actor, user, onClose }: { actor: UserDto; user: UserDto; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [role, setRole] = useState<Role>(user.role);
  const [managerId, setManagerId] = useState<string | null>(user.managerId);
  const [error, setError] = useState<string | null>(null);
  const rule = MANAGER_RULES[role];
  const managers = useManagerCandidates(role, !!rule.managerRole);

  const mutation = useMutation({
    mutationFn: (input: UpdateUserInput) => api<UserDto>(`/users/${user.id}`, { method: 'PATCH', body: input }),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: usersKeys.all });
      toast.success(`${updated.name} updated`);
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not update the user'),
  });

  const save = () => {
    setError(null);
    const input: UpdateUserInput = {};
    if (role !== user.role) input.role = role;
    const nextManager = rule.managerRole ? managerId : null;
    if (nextManager !== user.managerId || role !== user.role) input.managerId = nextManager;
    if (Object.keys(input).length === 0) return onClose();
    mutation.mutate(input);
  };

  return (
    <div className="grid grid-cols-1 gap-4">
      <DialogHeader>
        <DialogTitle>Edit {user.name}</DialogTitle>
        <DialogDescription>{user.email}</DialogDescription>
      </DialogHeader>
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="grid grid-cols-1 gap-2">
        <Label htmlFor="edit-role">Role</Label>
        <Select
          value={role}
          onValueChange={(v) => {
            setRole(v as Role);
            setManagerId(null);
          }}
        >
          <SelectTrigger id="edit-role" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {assignableRoles(actor).map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {rule.managerRole && (
        <div className="grid grid-cols-1 gap-2">
          <Label htmlFor="edit-manager">
            Manager ({ROLE_LABELS[rule.managerRole]}){!rule.required && ' — optional'}
          </Label>
          <Select value={managerId ?? ''} onValueChange={(v) => setManagerId(v === 'none' ? null : v)}>
            <SelectTrigger id="edit-manager" className="w-full">
              <SelectValue placeholder="Select a manager" />
            </SelectTrigger>
            <SelectContent>
              {!rule.required && <SelectItem value="none">No manager</SelectItem>}
              {managers.data
                ?.filter((m) => m.id !== user.id)
                .map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={save} disabled={mutation.isPending || (rule.required && !managerId)}>
          {mutation.isPending && <Loader2 className="animate-spin" />}
          Save
        </Button>
      </DialogFooter>
    </div>
  );
}
