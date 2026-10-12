import type { FitmentPhotoDto } from '@champ/shared';
import { formatIst } from '@/lib/format';

/** "Arjun", "12 Oct 2026, 10:40" (taken, else uploaded, in IST) and "GPS 12.97000, 77.59000" when known. */
export function photoMeta(p: FitmentPhotoDto): string[] {
  const parts = [p.uploadedBy.name, formatIst(p.takenAt ?? p.createdAt)];
  if (p.lat !== null && p.lng !== null) parts.push(`GPS ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`);
  return parts;
}

/** "Replaced by Suraj · 12 Oct 2026, 10:40 · reason" for a photo from the history; null for an active one. */
export function photoChangeText(p: FitmentPhotoDto): string | null {
  if (p.status === 'ACTIVE') return null;
  const verb = p.status === 'REPLACED' ? 'Replaced' : 'Removed';
  return [`${verb} by ${p.changedBy?.name ?? 'someone'}`, p.changedAt && formatIst(p.changedAt), p.changeReason].filter(Boolean).join(' · ');
}

/**
 * `onEscapeKeyDown` of a dialog or sheet that holds a photo gallery: while the lightbox is open, Escape closes
 * only the lightbox (Radix listens on the document first, so it would close the dialog too).
 */
export function keepOpenForLightbox(event: KeyboardEvent) {
  if (document.querySelector('.yarl__root')) event.preventDefault();
}
