import { Suspense, lazy, useRef, useState } from 'react';
import { History, RefreshCw, Trash2 } from 'lucide-react';
import { PHOTO_KIND_LABELS, PHOTO_KIND_ORDER, type FitmentPhotoDto } from '@champ/shared';
import { EmptyState, ErrorState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { TONES } from '@/lib/tones';
import { cn } from '@/lib/utils';
import { RemovePhotoDialog, ReplacePhotoDialog } from './photo-change-dialogs';
import { LIGHTBOX_LAYER, photoChangeText, photoMeta, photoSlides } from './photo-meta';
import { useFitmentPhotos } from './queries';

const PhotoLightbox = lazy(() => import('./photo-lightbox'));


interface Props {
  fitmentId: string;
  /** Show the Replace / Remove buttons when the server allows (default true). */
  manage?: boolean;
  /** Offer the "Show history" toggle when the server allows (default true). */
  allowHistory?: boolean;
  /** Smaller thumbnails (the verification sheet's left column). */
  compact?: boolean;
}

/**
 * A fitment's photos (F06): thumbnails grouped by kind (Before, Asset, Cluster, Placement, After, Debug), a
 * lightbox with zoom and next/previous, Replace and Remove for managers, and (SA, OM, the task's OE) a
 * "Show history" toggle with replaced and removed photos greyed out. URLs are presigned and refreshed by the
 * query (every ~8 minutes and on window focus).
 */
export function PhotoGallery({ fitmentId, manage = true, allowHistory = true, compact = false }: Props) {
  const [history, setHistory] = useState(false);
  const [open, setOpen] = useState(-1);
  const [replacing, setReplacing] = useState<FitmentPhotoDto | null>(null);
  const [removing, setRemoving] = useState<FitmentPhotoDto | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const { data, isPending, isError, error, refetch } = useFitmentPhotos(fitmentId, history);

  if (isPending) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading photos" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="aspect-square w-full" />
        ))}
      </div>
    );
  }
  if (isError) return <ErrorState error={error} size="sm" onRetry={() => void refetch()} />;

  const photos = data.items;
  const canManage = manage && data.canManage;
  const groups = PHOTO_KIND_ORDER.map((kind) => ({ kind, items: photos.filter((p) => p.kind === kind) })).filter((g) => g.items.length);

  return (
    <div ref={wrapper} className="grid gap-4" data-testid="photo-gallery">
      {allowHistory && data.canViewHistory && (
        <div className="flex items-center gap-2">
          <Switch id={`photo-history-${fitmentId}`} checked={history} onCheckedChange={setHistory} />
          <Label htmlFor={`photo-history-${fitmentId}`} className="flex items-center gap-1 font-normal">
            <History className="size-4" aria-hidden /> Show history
          </Label>
        </div>
      )}
      {photos.length === 0 ? (
        <EmptyState size="sm" illustration="empty" title="No photos yet" description="The technician's photos show here once the fitment is submitted." />
      ) : (
        groups.map(({ kind, items }) => (
          <section key={kind} className="grid gap-2" aria-label={`${PHOTO_KIND_LABELS[kind]} photos`} data-testid="photo-group">
            <h3 className="text-sm font-medium">
              {PHOTO_KIND_LABELS[kind]} <span className="text-muted-foreground">({items.length})</span>
            </h3>
            <ul className={cn('grid gap-2', compact ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4')}>
              {items.map((p, i) => {
                const label = `${PHOTO_KIND_LABELS[kind]} photo${items.length > 1 ? ` ${i + 1}` : ''}`;
                const change = photoChangeText(p);
                return (
                  <li key={p.id} className="grid min-w-0 content-start gap-1" data-testid="photo-item" data-status={p.status}>
                    <button
                      type="button"
                      className="overflow-hidden rounded-md border focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      aria-label={`Open ${label}${change ? ' (history)' : ''}`}
                      onClick={() => setOpen(photos.indexOf(p))}
                    >
                      <img
                        src={p.url}
                        alt={label}
                        loading="lazy"
                        className={cn('aspect-square w-full object-cover', change && 'opacity-50 grayscale')}
                      />
                    </button>
                    {!compact && <div className="text-xs break-words text-muted-foreground">{photoMeta(p).slice(0, 2).join(' · ')}</div>}
                    {change && (
                      <Badge variant="outline" className={cn('h-auto w-full justify-start overflow-visible rounded-md py-1 text-left break-words whitespace-normal', TONES.neutral)} data-testid="photo-change">
                        {change}
                      </Badge>
                    )}
                    {canManage && !change && (
                      <div className="flex flex-wrap gap-1">
                        <Button type="button" size="sm" variant="outline" aria-label={`Replace ${label}`} onClick={() => setReplacing(p)}>
                          <RefreshCw /> Replace
                        </Button>
                        <Button type="button" size="sm" variant="ghost" aria-label={`Remove ${label}`} onClick={() => setRemoving(p)}>
                          <Trash2 /> Remove
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
      {open >= 0 && (
        <Suspense fallback={null}>
          <PhotoLightbox slides={photoSlides(photos)} index={open} onClose={() => setOpen(-1)} root={() => wrapper.current?.closest(LIGHTBOX_LAYER) ?? null} />
        </Suspense>
      )}
      {replacing && <ReplacePhotoDialog fitmentId={fitmentId} photo={replacing} onClose={() => setReplacing(null)} />}
      {removing && <RemovePhotoDialog fitmentId={fitmentId} photo={removing} onClose={() => setRemoving(null)} />}
    </div>
  );
}

