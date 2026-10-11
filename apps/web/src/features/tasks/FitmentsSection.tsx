import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Pencil } from 'lucide-react';
import { isFitmentAssignable, type FitmentDto, type TaskDto, type UpdateFitmentInput } from '@champ/shared';
import { SearchableSelect } from '@/components/SearchableSelect';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ApiError } from '@/lib/api';
import { useAssignFitments, useTaskOptions, useUpdateFitment } from './queries';
import { FitmentStatusBadge } from './TaskStatusBadge';

const vehicleText = (f: FitmentDto) =>
  [f.vehicleRegNo, f.chassisNo && `Chassis ${f.chassisNo}`, f.assetNumber && `Asset ${f.assetNumber}`, f.oldDeviceId && `Old device ${f.oldDeviceId}`]
    .filter(Boolean)
    .join(' · ') || '—';

/**
 * The fitments of a task: per-row checkboxes for bulk assign/unassign (technician combobox) and an inline
 * vehicle editor while a fitment is Open or Assigned. Read-only for users who can't assign.
 */
export function FitmentsSection({ task }: { task: TaskDto }) {
  const manage = task.permissions.canAssign;
  const editable = (f: FitmentDto) => manage && isFitmentAssignable(f.status);
  const selectable = task.fitments.filter(editable);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [technicianId, setTechnicianId] = useState<string | null>(null);
  const [editing, setEditing] = useState<FitmentDto | null>(null);
  const options = useTaskOptions();
  const assign = useAssignFitments(task.id);

  // Drop selections that are no longer selectable (e.g. after a refresh).
  const chosen = selectable.filter((f) => selected.has(f.id)).map((f) => f.id);
  const allChecked = chosen.length > 0 && chosen.length === selectable.length;
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const toggleAll = (on: boolean) => setSelected(on ? new Set(selectable.map((f) => f.id)) : new Set());

  const run = (target: string | null) => {
    const name = options.data?.technicians.find((t) => t.id === target)?.name;
    assign.mutate(
      { fitmentIds: chosen, technicianId: target },
      {
        onSuccess: () => {
          toast.success(target ? `Assigned ${chosen.length} fitment(s) to ${name}` : `Unassigned ${chosen.length} fitment(s)`);
          setSelected(new Set());
        },
        onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Could not update the assignment'),
      },
    );
  };

  const checkbox = (f: FitmentDto) =>
    editable(f) ? (
      <Checkbox aria-label={`Select ${f.tkId}`} checked={selected.has(f.id)} onCheckedChange={(v) => toggle(f.id, v === true)} />
    ) : null;
  const editButton = (f: FitmentDto) =>
    editable(f) ? (
      <Button variant="ghost" size="icon-sm" aria-label={`Edit vehicle ${f.tkId}`} onClick={() => setEditing(f)}>
        <Pencil />
      </Button>
    ) : null;

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>Fitments</CardTitle>
        <CardDescription data-testid="fitment-counts">
          {task.counts.total} total · {task.counts.assigned} assigned · {task.counts.open} open
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4">
        {manage && selectable.length > 0 && (
          <div className="grid grid-cols-1 gap-2 rounded-md border bg-muted/40 p-3 sm:flex sm:flex-wrap sm:items-center">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                aria-label="Select all fitments"
                checked={allChecked ? true : chosen.length > 0 ? 'indeterminate' : false}
                onCheckedChange={(v) => toggleAll(v === true)}
              />
              <span data-testid="selected-count">{chosen.length} selected</span>
            </label>
            <SearchableSelect
              aria-label="Technician to assign"
              className="sm:w-64"
              value={technicianId}
              onChange={setTechnicianId}
              options={(options.data?.technicians ?? []).map((t) => ({ value: t.id, label: t.name, hint: t.baseLocation ?? undefined }))}
              placeholder="Choose a technician"
              searchPlaceholder="Search technician"
            />
            <div className="flex gap-2">
              <Button disabled={!chosen.length || !technicianId || assign.isPending} onClick={() => run(technicianId)}>
                {assign.isPending && <Loader2 className="animate-spin" />} Assign
              </Button>
              <Button variant="outline" disabled={!chosen.length || assign.isPending} onClick={() => run(null)}>
                Unassign
              </Button>
            </div>
          </div>
        )}

        <div className="hidden rounded-md border md:block">
          <Table>
            <TableHeader>
              <TableRow>
                {manage && <TableHead className="w-10"><span className="sr-only">Select</span></TableHead>}
                <TableHead>TK id</TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead>Technician</TableHead>
                <TableHead>Status</TableHead>
                {manage && <TableHead className="w-12"><span className="sr-only">Actions</span></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {task.fitments.map((f) => (
                <TableRow key={f.id} data-testid="fitment-row" data-status={f.status}>
                  {manage && <TableCell>{checkbox(f)}</TableCell>}
                  <TableCell className="font-mono">{f.tkId}</TableCell>
                  <TableCell className="whitespace-normal">{vehicleText(f)}</TableCell>
                  <TableCell data-testid="fitment-technician">{f.technician?.name ?? '—'}</TableCell>
                  <TableCell>
                    <FitmentStatusBadge status={f.status} />
                  </TableCell>
                  {manage && <TableCell>{editButton(f)}</TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <ul className="grid grid-cols-1 gap-2 md:hidden">
          {task.fitments.map((f) => (
            <li key={f.id} data-testid="fitment-card" data-status={f.status} className="flex items-start gap-3 rounded-md border p-3">
              {manage && <div className="pt-0.5">{checkbox(f)}</div>}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-medium">{f.tkId}</span>
                  <FitmentStatusBadge status={f.status} />
                </div>
                <div className="mt-1 text-sm break-words text-muted-foreground">{vehicleText(f)}</div>
                <div className="text-sm" data-testid="fitment-technician">
                  {f.technician?.name ?? 'No technician'}
                </div>
              </div>
              {manage && editButton(f)}
            </li>
          ))}
        </ul>
      </CardContent>
      {editing && <VehicleDialog taskId={task.id} fitment={editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

const VEHICLE_FIELDS: { key: keyof UpdateFitmentInput; label: string }[] = [
  { key: 'vehicleRegNo', label: 'Registration number' },
  { key: 'chassisNo', label: 'Chassis number' },
  { key: 'assetNumber', label: 'Asset number' },
  { key: 'oldDeviceId', label: 'Old device id' },
];

function VehicleDialog({ taskId, fitment, onClose }: { taskId: string; fitment: FitmentDto; onClose: () => void }) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(VEHICLE_FIELDS.map(({ key }) => [key, fitment[key] ?? ''])) as Record<keyof UpdateFitmentInput, string>,
  );
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateFitment(taskId);
  const save = () => {
    setError(null);
    update.mutate(
      { fitmentId: fitment.id, body: values },
      {
        onSuccess: () => {
          toast.success(`${fitment.tkId} saved`);
          onClose();
        },
        onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not save'),
      },
    );
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Vehicle for {fitment.tkId}</DialogTitle>
          <DialogDescription>All fields are optional; the technician can complete them on site.</DialogDescription>
        </DialogHeader>
        <form
          className="grid grid-cols-1 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          {VEHICLE_FIELDS.map(({ key, label }) => (
            <div key={key} className="grid grid-cols-1 gap-2">
              <Label htmlFor={`vehicle-${key}`}>{label}</Label>
              <Input
                id={`vehicle-${key}`}
                value={values[key]}
                maxLength={50}
                onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
              />
            </div>
          ))}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending && <Loader2 className="animate-spin" />} Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
