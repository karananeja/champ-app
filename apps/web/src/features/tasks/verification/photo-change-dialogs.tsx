import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { PHOTO_KIND_LABELS, photoReasonSchema, type FitmentPhotoDto } from '@champ/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { PhotoDropzone, UploadProgress } from './photo-upload';
import { useRemovePhoto, useReplacePhoto } from './queries';

interface Props {
  fitmentId: string;
  photo: FitmentPhotoDto;
  onClose: () => void;
}

function ReasonField({ id, value, onChange, invalid }: { id: string; value: string; onChange: (v: string) => void; invalid: boolean }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>Reason</Label>
      <Textarea
        id={id}
        value={value}
        rows={2}
        maxLength={300}
        aria-invalid={invalid}
        placeholder="Why is this photo being changed?"
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/**
 * Replace a photo (D-100): pick a corrected image and give a reason (3–300 characters). The original stays in
 * the history as "replaced". Client-side checks first; server refusals are shown verbatim.
 */
export function ReplacePhotoDialog({ fitmentId, photo, onClose }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const replace = useReplacePhoto(fitmentId);
  const kind = PHOTO_KIND_LABELS[photo.kind];

  const submit = () => {
    setError(null);
    if (!file) return setError('Choose the corrected image');
    const parsed = photoReasonSchema.safeParse(reason);
    if (!parsed.success) return setError(parsed.error.issues[0]!.message);
    setProgress(0);
    replace.mutate(
      { photoId: photo.id, file, reason: parsed.data, onProgress: setProgress },
      {
        onSuccess: () => {
          toast.success(`${kind} photo replaced`);
          onClose();
        },
        onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not replace the photo'),
        onSettled: () => setProgress(null),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Replace {kind.toLowerCase()} photo</DialogTitle>
          <DialogDescription>The original is kept in the history, marked as replaced.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <PhotoDropzone
            label={file ? 'Choose another image' : 'Choose the corrected image'}
            hint={file ? `${file.name} (${Math.ceil(file.size / 1024)} KB)` : undefined}
            disabled={replace.isPending}
            onFile={(f) => {
              setFile(f);
              setError(null);
            }}
            onInvalid={setError}
          />
          <ReasonField id="replace-reason" value={reason} onChange={setReason} invalid={!!error} />
          {progress !== null && <UploadProgress value={progress} />}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={replace.isPending}>
              {replace.isPending && <Loader2 className="animate-spin" />} Replace photo
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Remove a wrong extra photo with a reason (3–300 characters); it stays in the history as "removed". */
export function RemovePhotoDialog({ fitmentId, photo, onClose }: Props) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const remove = useRemovePhoto(fitmentId);
  const kind = PHOTO_KIND_LABELS[photo.kind];

  const submit = () => {
    setError(null);
    const parsed = photoReasonSchema.safeParse(reason);
    if (!parsed.success) return setError(parsed.error.issues[0]!.message);
    remove.mutate(
      { photoId: photo.id, reason: parsed.data },
      {
        onSuccess: () => {
          toast.success(`${kind} photo removed`);
          onClose();
        },
        onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not remove the photo'),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {kind.toLowerCase()} photo?</DialogTitle>
          <DialogDescription>It disappears from the photos but stays in the history, marked as removed.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <ReasonField id="remove-reason" value={reason} onChange={setReason} invalid={!!error} />
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={remove.isPending}>
              {remove.isPending && <Loader2 className="animate-spin" />} Remove photo
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
