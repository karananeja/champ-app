import Lightbox from 'yet-another-react-lightbox';
import Captions from 'yet-another-react-lightbox/plugins/captions';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import 'yet-another-react-lightbox/styles.css';
import 'yet-another-react-lightbox/plugins/captions.css';
import type { LightboxSlide } from './photo-meta';

interface Props {
  /** The images to browse (fitment photos via `photoSlides`, F08 travel receipts via `receiptSlides`). */
  slides: LightboxSlide[];
  /** The open slide, or -1 when closed. */
  index: number;
  onClose: () => void;
  /** Where to mount (inside the open dialog or sheet, so its focus trap and pointer events still work). */
  root?: () => Element | null;
}

/**
 * Full-screen photo viewer (yet-another-react-lightbox): next/previous by keyboard, buttons or swipe, pinch
 * and wheel zoom, and a caption (for photos: the kind, uploader, IST time and GPS). Loaded lazily (its own chunk).
 */
export default function PhotoLightbox({ slides, index, onClose, root }: Props) {
  return (
    <Lightbox
      open={index >= 0}
      index={Math.max(index, 0)}
      close={onClose}
      plugins={[Zoom, Captions]}
      portal={{ root: root ?? null }}
      zoom={{ maxZoomPixelRatio: 3, scrollToZoom: true }}
      captions={{ descriptionTextAlign: 'center', descriptionMaxLines: 4 }}
      carousel={{ finite: slides.length <= 1 }}
      labels={{ Close: 'Close photo viewer' }}
      slides={slides}
    />
  );
}
