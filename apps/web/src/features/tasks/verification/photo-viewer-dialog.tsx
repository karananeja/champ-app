import type { FitmentDto } from '@champ/shared';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PhotoGallery } from './photo-gallery';
import { keepOpenForLightbox } from './photo-meta';

/**
 * The photo viewer of one fitment (F06): a near full-screen dialog with the grouped gallery. It is positioned
 * without a CSS translate so the lightbox (mounted inside it) can cover the whole screen.
 */
export function PhotoViewerDialog({ fitment, onClose }: { fitment: FitmentDto; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="inset-0 top-0 left-0 flex max-h-none w-auto max-w-none translate-x-0 translate-y-0 flex-col overflow-y-auto rounded-none p-4 sm:inset-6 sm:max-w-none sm:rounded-lg sm:p-6"
        onEscapeKeyDown={keepOpenForLightbox}
      >
        <DialogHeader>
          <DialogTitle>Photos · {fitment.tkId}</DialogTitle>
          <DialogDescription>
            {fitment.photoCounts.active} photo(s){fitment.technician ? ` · ${fitment.technician.name}` : ''}. Open a photo to zoom and
            browse.
          </DialogDescription>
        </DialogHeader>
        <PhotoGallery fitmentId={fitment.id} />
      </DialogContent>
    </Dialog>
  );
}
