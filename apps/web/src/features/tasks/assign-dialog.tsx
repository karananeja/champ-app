import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { SearchableSelect } from '@/components/searchable-select';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { assigneeName, assigneeOptions } from './assignees';
import { useTaskOptions } from './queries';

/**
 * Asks for the technician of one or more fitments (F07: board drops Open → Assigned and the quick view's
 * "Change technician"). The technician combobox lists the active OTs from `/tasks/options` and the OEs the
 * caller may assign to, labelled "(OE)" (F10, D-158), like the task page's assign bar. `onConfirm` gets the technician's id and name; the caller runs the assignment.
 */
export function AssignDialog({
  tkIds,
  currentTechnicianId = null,
  title,
  pending = false,
  onConfirm,
  onClose,
}: {
  tkIds: string[];
  currentTechnicianId?: string | null;
  title?: string;
  pending?: boolean;
  onConfirm: (technician: { id: string; name: string }) => void;
  onClose: () => void;
}) {
  const options = useTaskOptions();
  const [technicianId, setTechnicianId] = useState<string | null>(currentTechnicianId);
  const [error, setError] = useState<string | null>(null);
  const choices = assigneeOptions(options.data);
  const label = tkIds.length === 1 ? tkIds[0] : `${tkIds.length} fitments`;

  const submit = () => {
    const name = assigneeName(options.data, technicianId);
    if (!technicianId || !name) {
      setError('Choose a technician');
      return;
    }
    onConfirm({ id: technicianId, name });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title ?? `Assign ${label}`}</DialogTitle>
          <DialogDescription>
            {tkIds.length > 1 ? `${tkIds.join(', ')} go to the technician you choose.` : 'The fitment goes to the technician you choose.'}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid grid-cols-1 gap-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="grid grid-cols-1 gap-2">
            <Label htmlFor="assign-technician">Technician</Label>
            <SearchableSelect
              id="assign-technician"
              aria-label="Technician"
              aria-invalid={!!error}
              value={technicianId}
              onChange={(v) => {
                setTechnicianId(v);
                setError(null);
              }}
              options={choices}
              placeholder={options.isPending ? 'Loading technicians…' : 'Choose a technician'}
              searchPlaceholder="Search technician"
            />
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />} Assign
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
