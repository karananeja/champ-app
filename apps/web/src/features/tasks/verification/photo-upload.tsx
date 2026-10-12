import { useId, useRef, useState, type DragEvent } from 'react';
import { toast } from 'sonner';
import { ImageUp, Loader2 } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useUploadDebugPhoto } from './queries';
import { PHOTO_ACCEPT, validateImageFile } from './upload-validation';

interface DropzoneProps {
  /** Visible label (also names the file input). */
  label: string;
  hint?: string;
  disabled?: boolean;
  /** Called with a file that passed the client-side checks. */
  onFile: (file: File) => void;
  /** Called with the message when a file fails them. */
  onInvalid: (message: string) => void;
  className?: string;
}

/**
 * A drop area with a file picker for one image (JPEG, PNG or WebP, ≤ 10 MB), checked in the browser before
 * anything is sent. Keyboard users get the picker through the visible button.
 */
export function PhotoDropzone({ label, hint, disabled, onFile, onInvalid, className }: DropzoneProps) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const take = (file: File | undefined) => {
    if (!file) return;
    const error = validateImageFile(file);
    if (error) onInvalid(error);
    else onFile(file);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (!disabled) take(e.dataTransfer.files[0]);
  };

  return (
    <div
      data-testid="photo-dropzone"
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        'flex flex-col items-center gap-2 rounded-md border border-dashed p-4 text-center text-sm',
        over && 'border-primary bg-primary/5',
        disabled && 'opacity-60',
        className,
      )}
    >
      <ImageUp className="size-5 text-muted-foreground" aria-hidden />
      <label htmlFor={inputId} className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline">
        {label}
      </label>
      <span className="text-xs text-muted-foreground">{hint ?? 'Drag an image here, or choose one. JPEG, PNG or WebP, up to 10 MB.'}</span>
      <input
        ref={input}
        id={inputId}
        type="file"
        accept={PHOTO_ACCEPT}
        className="sr-only"
        disabled={disabled}
        onChange={(e) => {
          take(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}

/** An upload in progress (0–1). */
export function UploadProgress({ value, label = 'Uploading' }: { value: number; label?: string }) {
  const percent = Math.round(value * 100);
  return (
    <div className="grid gap-1 text-xs text-muted-foreground" data-testid="upload-progress">
      <div className="flex items-center gap-2">
        <Loader2 className="size-3 animate-spin" aria-hidden /> {label}… {percent}%
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/**
 * Debug image upload on the verification sheet (D-032): uploads as soon as a valid file is picked or
 * dropped, with progress; server refusals (e.g. a fake image) are shown verbatim.
 */
export function DebugPhotoUpload({ fitmentId, tkId }: { fitmentId: string; tkId: string }) {
  const upload = useUploadDebugPhoto(fitmentId);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = (file: File) => {
    setError(null);
    setProgress(0);
    upload.mutate(
      { file, onProgress: setProgress },
      {
        onSuccess: () => toast.success(`Debug image added to ${tkId}`),
        onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not upload the image'),
        onSettled: () => setProgress(null),
      },
    );
  };

  return (
    <div className="grid gap-2">
      <PhotoDropzone label="Upload a debug image" disabled={upload.isPending} onFile={send} onInvalid={setError} />
      {progress !== null && <UploadProgress value={progress} />}
      {error && (
        <p className="text-sm text-destructive" role="alert" data-testid="upload-error">
          {error}
        </p>
      )}
    </div>
  );
}
