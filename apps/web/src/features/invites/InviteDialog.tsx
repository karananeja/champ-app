import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Loader2, TriangleAlert } from 'lucide-react';
import {
  MANAGER_RULES,
  ROLE_LABELS,
  createInviteSchema,
  type CreateInviteInput,
  type CreateInviteResponse,
  type Role,
  type UserDto,
} from '@champ/shared';
import { FieldError } from '@/components/FieldError';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ApiError, api } from '@/lib/api';
import { invitableRoles } from '@/lib/permissions';
import { BaseLocationField, TechnicianTypeField } from '../technicians/TechnicianFields';
import { useManagerCandidates, usersKeys } from '../users/queries';

interface Props {
  actor: UserDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InviteDialog({ actor, open, onOpenChange }: Props) {
  const [result, setResult] = useState<CreateInviteResponse | null>(null);

  const handleOpenChange = (next: boolean) => {
    if (!next) setResult(null); // the link must never be shown again
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-md">
        {result ? (
          <InviteLinkView result={result} onDone={() => handleOpenChange(false)} />
        ) : (
          <InviteForm actor={actor} onCreated={setResult} onCancel={() => handleOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** True when the actor is forced to be the manager (an OE inviting an OT). */
const isManagerForced = (actor: UserDto, role: Role) => actor.role === 'OE' && role === 'OT';

function defaultManagerId(actor: UserDto, role: Role): string | null {
  return MANAGER_RULES[role].managerRole === actor.role ? actor.id : null;
}

function InviteForm({
  actor,
  onCreated,
  onCancel,
}: {
  actor: UserDto;
  onCreated: (result: CreateInviteResponse) => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const roles = invitableRoles(actor);
  const firstRole = roles[0]!;
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    setValue,
    setError,
    formState: { errors },
  } = useForm<CreateInviteInput>({
    resolver: zodResolver(createInviteSchema),
    defaultValues: { email: '', role: firstRole, managerId: defaultManagerId(actor, firstRole), jobTitle: '' },
  });

  const role = useWatch({ control, name: 'role' });
  const rule = MANAGER_RULES[role];
  const forced = isManagerForced(actor, role);
  const showManagerSelect = !!rule.managerRole && !forced;
  const managers = useManagerCandidates(role, showManagerSelect);

  const mutation = useMutation({
    mutationFn: (input: CreateInviteInput) => api<CreateInviteResponse>('/invites', { method: 'POST', body: input }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: usersKeys.invites });
      onCreated(data);
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        for (const [field, messages] of Object.entries(err.fieldErrors)) {
          if (messages?.[0]) setError(field as keyof CreateInviteInput, { message: messages[0] });
        }
        if (err.code === 'EMAIL_EXISTS') setError('email', { message: err.message });
        else if (err.code === 'INVALID_REFERENCE' || err.code === 'INACTIVE_REFERENCE') {
          setError('baseLocationId', { message: err.message });
        }
        else if (err.code.startsWith('MANAGER_')) setError('managerId', { message: err.message });
        else setServerError(err.message);
      } else {
        setServerError('Something went wrong. Please try again.');
      }
    },
  });

  const submit = handleSubmit((values) => {
    setServerError(null);
    if (showManagerSelect && rule.required && !values.managerId) {
      setError('managerId', { message: `Choose a ${ROLE_LABELS[rule.managerRole!]}` });
      return;
    }
    const isTechnician = values.role === 'OT';
    mutation.mutate({
      ...values,
      managerId: forced ? actor.id : showManagerSelect ? values.managerId || null : null,
      jobTitle: values.jobTitle || undefined,
      // Technician fields only travel with OT invites (F02).
      technicianType: isTechnician ? values.technicianType : undefined,
      baseLocationId: isTechnician ? values.baseLocationId : undefined,
    });
  });

  return (
    <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-4">
      <DialogHeader>
        <DialogTitle>Invite user</DialogTitle>
        <DialogDescription>Create a one-time invite link to share with the new user.</DialogDescription>
      </DialogHeader>

      {serverError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-2">
        <Label htmlFor="invite-email">Email</Label>
        <Input
          id="invite-email"
          type="email"
          placeholder="name@intellicar.in"
          aria-invalid={!!errors.email}
          {...register('email')}
        />
        <FieldError id="invite-email-error" message={errors.email?.message} />
      </div>

      <div className="grid grid-cols-1 gap-2">
        <Label htmlFor="invite-role">Role</Label>
        <Controller
          control={control}
          name="role"
          render={({ field }) => (
            <Select
              value={field.value}
              onValueChange={(value) => {
                const next = value as Role;
                field.onChange(next);
                setValue('managerId', defaultManagerId(actor, next));
              }}
            >
              <SelectTrigger id="invite-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      {forced && (
        <p className="text-sm text-muted-foreground">
          Manager: <span className="font-medium text-foreground">{actor.name}</span> (you)
        </p>
      )}

      {showManagerSelect && (
        <div className="grid grid-cols-1 gap-2">
          <Label htmlFor="invite-manager">
            Manager ({ROLE_LABELS[rule.managerRole!]}){!rule.required && ' — optional'}
          </Label>
          <Controller
            control={control}
            name="managerId"
            render={({ field }) => (
              <Select value={field.value ?? ''} onValueChange={(v) => field.onChange(v === 'none' ? null : v)}>
                <SelectTrigger id="invite-manager" className="w-full" aria-invalid={!!errors.managerId}>
                  <SelectValue placeholder={managers.isPending ? 'Loading…' : 'Select a manager'} />
                </SelectTrigger>
                <SelectContent>
                  {!rule.required && <SelectItem value="none">No manager</SelectItem>}
                  {managers.data?.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                      {m.id === actor.id && ' (you)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {managers.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No active {ROLE_LABELS[rule.managerRole!]} yet — invite one first.
            </p>
          )}
          <FieldError id="invite-manager-error" message={errors.managerId?.message} />
        </div>
      )}

      {role === 'OT' && (
        <>
          <Controller
            control={control}
            name="technicianType"
            render={({ field }) => (
              <TechnicianTypeField
                id="invite-technician-type"
                value={field.value}
                onChange={field.onChange}
                error={errors.technicianType?.message}
              />
            )}
          />
          <Controller
            control={control}
            name="baseLocationId"
            render={({ field }) => (
              <BaseLocationField
                id="invite-base-location"
                value={field.value}
                onChange={field.onChange}
                error={errors.baseLocationId?.message}
              />
            )}
          />
        </>
      )}

      <div className="grid grid-cols-1 gap-2">
        <Label htmlFor="invite-job-title">Job title — optional</Label>
        <Input id="invite-job-title" {...register('jobTitle')} />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending && <Loader2 className="animate-spin" />}
          Create invite
        </Button>
      </DialogFooter>
    </form>
  );
}

export function InviteLinkView({ result, onDone }: { result: CreateInviteResponse; onDone: () => void }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4">
      <DialogHeader>
        <DialogTitle>Invite created</DialogTitle>
        <DialogDescription>
          Share this link with <span className="font-medium text-foreground">{result.invite.email}</span> (
          {ROLE_LABELS[result.invite.role]}).
        </DialogDescription>
      </DialogHeader>
      <Alert className="border-amber-300 bg-amber-50 text-amber-900">
        <TriangleAlert />
        <AlertDescription className="text-amber-900">
          This link is shown only once and expires in 72 hours
        </AlertDescription>
      </Alert>
      <div className="flex gap-2">
        <Input
          readOnly
          value={result.link}
          aria-label="Invite link"
          data-testid="invite-link"
          onFocus={(e) => e.currentTarget.select()}
          className="font-mono text-xs"
        />
        <Button type="button" variant="outline" onClick={copy} aria-label="Copy link" className="shrink-0">
          {copied ? <Check /> : <Copy />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <DialogFooter>
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </div>
  );
}
