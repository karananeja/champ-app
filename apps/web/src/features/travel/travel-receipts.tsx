import { Suspense, lazy, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FileText, Loader2, Trash2 } from 'lucide-react';
import { TRAVEL_MAX_ATTACHMENTS, isPdf, type TravelAttachmentDto, type TravelTaskDto } from '@champ/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { formatIst } from '@/lib/format';
import { LIGHTBOX_LAYER, type LightboxSlide } from '../tasks/verification/photo-meta';
import { PhotoDropzone, UploadProgress } from '../tasks/verification/photo-upload';
import { RECEIPT_ACCEPT, validateReceiptFile } from '../tasks/verification/upload-validation';
import { useRemoveReceipt, useUploadReceipt } from './queries';

const PhotoLightbox = lazy(() => import('../tasks/verification/photo-lightbox'));

const receiptName = (a: TravelAttachmentDto) => a.originalName ?? (isPdf(a.contentType) ? 'Receipt (PDF)' : 'Receipt');

/** Receipt images as lightbox slides: the file name as title, uploader and IST time as caption. */
const receiptSlides = (images: TravelAttachmentDto[]): LightboxSlide[] =>
  images.map((a) => ({
    src: a.url,
    alt: receiptName(a),
    width: a.width ?? undefined,
    height: a.height ?? undefined,
    title: receiptName(a),
    description: `${a.uploadedBy.name} · ${formatIst(a.createdAt)}`,
  }));

/** Removes a receipt with an optional reason; the file is kept (as D-100). */
function RemoveReceiptDialog({ tt, attachment, onClose }: { tt: TravelTaskDto; attachment: TravelAttachmentDto; onClose: () => void }) {
  const remove = useRemoveReceipt();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {receiptName(attachment)}?</DialogTitle>
          <DialogDescription>It disappears from {tt.ttId}; the history keeps a record of it.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="receipt-remove-reason">
            Reason <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Textarea id="receipt-remove-reason" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
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
          <Button
            type="button"
            variant="destructive"
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate(
                { id: tt.id, attachmentId: attachment.id, reason: reason.trim() || undefined },
                {
                  onSuccess: () => {
                    toast.success('Receipt removed');
                    onClose();
                  },
                  onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not remove the receipt'),
                },
              )
            }
          >
            {remove.isPending && <Loader2 className="animate-spin" />} Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The receipts of a TT (F08): images as thumbnails opening the F06 lightbox, PDFs as file chips that open in a
 * new tab (presigned URLs, refreshed with the detail). People who may change receipts can add (uploads at once,
 * with progress) and remove them.
 */
export function TravelReceipts({ tt }: { tt: TravelTaskDto }) {
  const [open, setOpen] = useState(-1);
  const [removing, setRemoving] = useState<TravelAttachmentDto | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const upload = useUploadReceipt();
  const images = tt.attachments.filter((a) => !isPdf(a.contentType));
  const pdfs = tt.attachments.filter((a) => isPdf(a.contentType));
  const canAdd = tt.canManageAttachments && tt.attachments.length < TRAVEL_MAX_ATTACHMENTS;

  const send = (file: File) => {
    setError(null);
    setProgress(0);
    upload.mutate(
      { id: tt.id, file, onProgress: setProgress },
      {
        onSuccess: () => toast.success(`Receipt added to ${tt.ttId}`),
        onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not upload the receipt'),
        onSettled: () => setProgress(null),
      },
    );
  };

  const removeButton = (a: TravelAttachmentDto) =>
    tt.canManageAttachments && (
      <Button type="button" size="icon" variant="ghost" className="size-7 shrink-0" aria-label={`Remove ${receiptName(a)}`} onClick={() => setRemoving(a)}>
        <Trash2 />
      </Button>
    );

  return (
    <div ref={wrapper} className="grid gap-3" data-testid="travel-receipts">
      {tt.attachments.length === 0 && <p className="text-sm text-muted-foreground">No receipts.</p>}
      {images.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {images.map((a, i) => (
            <li key={a.id} className="grid min-w-0 content-start gap-1" data-testid="receipt-image">
              <button
                type="button"
                className="overflow-hidden rounded-md border focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                aria-label={`Open ${receiptName(a)}`}
                onClick={() => setOpen(i)}
              >
                <img src={a.url} alt={receiptName(a)} loading="lazy" className="aspect-square w-full object-cover" />
              </button>
              <div className="flex min-w-0 items-center gap-1">
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{receiptName(a)}</span>
                {removeButton(a)}
              </div>
            </li>
          ))}
        </ul>
      )}
      {pdfs.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {pdfs.map((a) => (
            <li key={a.id} className="flex max-w-full min-w-0 items-center gap-1 rounded-full border py-0.5 pr-1 pl-3 text-sm" data-testid="receipt-pdf">
              <a href={a.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1.5 hover:underline">
                <FileText className="size-4 shrink-0" aria-hidden />
                <span className="truncate">{receiptName(a)}</span>
                <span className="sr-only">(PDF, opens in a new tab)</span>
              </a>
              {removeButton(a)}
            </li>
          ))}
        </ul>
      )}
      {canAdd && (
        <PhotoDropzone
          label="Add receipts"
          hint="Images or PDF, up to 10 MB each."
          accept={RECEIPT_ACCEPT}
          validate={validateReceiptFile}
          disabled={upload.isPending}
          onFile={send}
          onInvalid={setError}
        />
      )}
      {progress !== null && <UploadProgress value={progress} />}
      {error && (
        <p className="text-sm text-destructive" role="alert" data-testid="receipt-error">
          {error}
        </p>
      )}
      {open >= 0 && (
        <Suspense fallback={null}>
          <PhotoLightbox slides={receiptSlides(images)} index={open} onClose={() => setOpen(-1)} root={() => wrapper.current?.closest(LIGHTBOX_LAYER) ?? null} />
        </Suspense>
      )}
      {removing && <RemoveReceiptDialog tt={tt} attachment={removing} onClose={() => setRemoving(null)} />}
    </div>
  );
}
