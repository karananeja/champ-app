import { useState } from 'react';
import { Controller, useForm, type FieldValues, type Path, type UseFormSetError } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import {
  createTechnicianSchema,
  updateTechnicianSchema,
  type CreateInviteResponse,
  type CreateTechnicianInput,
  type TechnicianDto,
  type UpdateTechnicianInput,
  type UserDto,
} from '@champ/shared';
import { FieldError } from '@/components/field-error';
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
import { ApiError } from '@/lib/api';
import { InviteLinkView } from '../invites/invite-dialog';
import { useManagerCandidates } from '../users/queries';
import { HomeLocation } from './home-location';
import { BaseLocationField, TechnicianTypeField } from './technician-fields';
import { useCreateTechnician, useUpdateTechnician } from './queries';

interface Props {
  actor: UserDto;
  /** `null`: closed; `'new'`: add technician; a technician: edit. */
  target: TechnicianDto | 'new' | null;
  onOpenChange: (open: boolean) => void;
}

export function TechnicianDialog({ actor, target, onOpenChange }: Props) {
  const [result, setResult] = useState<CreateInviteResponse | null>(null);
  const handleOpenChange = (open: boolean) => {
    if (!open) setResult(null); // the invite link must never be shown again
    onOpenChange(open);
  };

  return (
    <Dialog open={target !== null} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-md">
        {result ? (
          <InviteLinkView result={result} onDone={() => handleOpenChange(false)} />
        ) : target === 'new' ? (
          <AddTechnicianForm actor={actor} onCreated={setResult} onCancel={() => handleOpenChange(false)} />
        ) : target ? (
          <EditTechnicianForm key={target.id} technician={target} onClose={() => handleOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Maps a server error onto form fields, or returns a message for the form-level alert. */
function applyServerError<T extends FieldValues>(err: unknown, setError: UseFormSetError<T>): string | null {
  if (!(err instanceof ApiError)) return 'Something went wrong. Please try again.';
  const fieldErrors = Object.entries(err.fieldErrors);
  for (const [field, messages] of fieldErrors) {
    if (messages?.[0]) setError(field as Path<T>, { message: messages[0] });
  }
  if (err.code === 'EMAIL_EXISTS') setError('email' as Path<T>, { message: err.message });
  else if (err.code.startsWith('MANAGER_')) setError('managerId' as Path<T>, { message: err.message });
  else if (fieldErrors.length === 0) return err.message;
  return null;
}

function AddTechnicianForm({
  actor,
  onCreated,
  onCancel,
}: {
  actor: UserDto;
  onCreated: (result: CreateInviteResponse) => void;
  onCancel: () => void;
}) {
  const managerForced = actor.role === 'OE';
  const managers = useManagerCandidates('OT', !managerForced);
  const create = useCreateTechnician();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<CreateTechnicianInput>({
    resolver: zodResolver(createTechnicianSchema),
    defaultValues: { name: '', phone: '', email: '', baseLocationId: '', managerId: managerForced ? actor.id : null },
  });

  const submit = handleSubmit((values) => {
    setServerError(null);
    if (!managerForced && !values.managerId) {
      setError('managerId', { message: 'Choose the reporting OE' });
      return;
    }
    create.mutate(
      { ...values, managerId: managerForced ? actor.id : values.managerId },
      {
        onSuccess: onCreated,
        onError: (err) => setServerError(applyServerError(err, setError)),
      },
    );
  });

  return (
    <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-4">
      <DialogHeader>
        <DialogTitle>Add technician</DialogTitle>
        <DialogDescription>Creates an invite link for the technician to set up their account.</DialogDescription>
      </DialogHeader>

      {serverError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-2">
        <Label htmlFor="tech-name">Name</Label>
        <Input id="tech-name" autoComplete="off" aria-invalid={!!errors.name} {...register('name')} />
        <FieldError id="tech-name-error" message={errors.name?.message} />
      </div>
      <div className="grid grid-cols-1 gap-2">
        <Label htmlFor="tech-phone">Contact number</Label>
        <Input id="tech-phone" type="tel" placeholder="+91 98765 43210" aria-invalid={!!errors.phone} {...register('phone')} />
        <FieldError id="tech-phone-error" message={errors.phone?.message} />
      </div>
      <div className="grid grid-cols-1 gap-2">
        <Label htmlFor="tech-email">Email</Label>
        <Input id="tech-email" type="email" placeholder="name@example.com" aria-invalid={!!errors.email} {...register('email')} />
        <FieldError id="tech-email-error" message={errors.email?.message} />
      </div>
      <Controller
        control={control}
        name="technicianType"
        render={({ field }) => (
          <TechnicianTypeField id="tech-type" value={field.value} onChange={field.onChange} error={errors.technicianType?.message} />
        )}
      />
      <Controller
        control={control}
        name="baseLocationId"
        render={({ field }) => (
          <BaseLocationField id="tech-location" value={field.value} onChange={field.onChange} error={errors.baseLocationId?.message} />
        )}
      />
      {managerForced ? (
        <p className="text-sm text-muted-foreground">
          Reports to: <span className="font-medium text-foreground">{actor.name}</span> (you)
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          <Label htmlFor="tech-manager">Reporting OE</Label>
          <Controller
            control={control}
            name="managerId"
            render={({ field }) => (
              <Select value={field.value ?? ''} onValueChange={field.onChange}>
                <SelectTrigger id="tech-manager" className="w-full" aria-invalid={!!errors.managerId}>
                  <SelectValue placeholder={managers.isPending ? 'Loading…' : 'Select an OE'} />
                </SelectTrigger>
                <SelectContent>
                  {managers.data?.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {managers.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">No active Operations Executive yet — invite one first.</p>
          )}
          <FieldError id="tech-manager-error" message={errors.managerId?.message} />
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending && <Loader2 className="animate-spin" />}
          Create invite
        </Button>
      </DialogFooter>
    </form>
  );
}

function EditTechnicianForm({ technician, onClose }: { technician: TechnicianDto; onClose: () => void }) {
  const update = useUpdateTechnician(technician.id);
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<UpdateTechnicianInput>({
    resolver: zodResolver(updateTechnicianSchema),
    defaultValues: {
      name: technician.name,
      phone: technician.phone ?? undefined,
      technicianType: technician.technicianType ?? undefined,
      baseLocationId: technician.baseLocationId ?? undefined,
    },
  });

  const submit = handleSubmit((values) => {
    setServerError(null);
    update.mutate(
      { ...values, phone: values.phone || undefined },
      {
        onSuccess: (updated) => {
          toast.success(`${updated.name} updated`);
          onClose();
        },
        onError: (err) => setServerError(applyServerError(err, setError)),
      },
    );
  });

  return (
    <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-4">
      <DialogHeader>
        <DialogTitle>Edit technician</DialogTitle>
        <DialogDescription>{technician.email}</DialogDescription>
      </DialogHeader>

      {serverError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-2">
        <Label htmlFor="edit-tech-name">Name</Label>
        <Input id="edit-tech-name" aria-invalid={!!errors.name} {...register('name')} />
        <FieldError id="edit-tech-name-error" message={errors.name?.message} />
      </div>
      <div className="grid grid-cols-1 gap-2">
        <Label htmlFor="edit-tech-phone">Contact number</Label>
        <Input id="edit-tech-phone" type="tel" aria-invalid={!!errors.phone} {...register('phone')} />
        <FieldError id="edit-tech-phone-error" message={errors.phone?.message} />
      </div>
      <Controller
        control={control}
        name="technicianType"
        render={({ field }) => (
          <TechnicianTypeField id="edit-tech-type" value={field.value} onChange={field.onChange} error={errors.technicianType?.message} />
        )}
      />
      <Controller
        control={control}
        name="baseLocationId"
        render={({ field }) => (
          <BaseLocationField
            id="edit-tech-location"
            value={field.value}
            onChange={field.onChange}
            error={errors.baseLocationId?.message}
            current={technician.baseLocation}
          />
        )}
      />
      <div className="grid grid-cols-1 gap-1 text-sm">
        <span className="font-medium">Home location</span>
        <HomeLocation value={technician.homeLocation} />
        <span className="text-xs text-muted-foreground">Set by the technician in the Champ field app.</span>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={update.isPending}>
          {update.isPending && <Loader2 className="animate-spin" />}
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
