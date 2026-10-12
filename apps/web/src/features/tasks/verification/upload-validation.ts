import { PHOTO_CONTENT_TYPES, PHOTO_MAX_BYTES, PHOTO_TOO_LARGE_MESSAGE, PHOTO_UNSUPPORTED_MESSAGE } from '@champ/shared';

/** The `accept` attribute of photo pickers. */
export const PHOTO_ACCEPT = PHOTO_CONTENT_TYPES.join(',');

/**
 * Checks a picked or dropped file before uploading (the server checks the real type again by its magic
 * bytes): JPEG, PNG or WebP by MIME type, at most 10 MB. Returns the error message, or null when it's fine.
 */
export function validateImageFile(file: Pick<File, 'type' | 'size'>): string | null {
  if (!(PHOTO_CONTENT_TYPES as readonly string[]).includes(file.type)) return PHOTO_UNSUPPORTED_MESSAGE;
  if (file.size > PHOTO_MAX_BYTES) return PHOTO_TOO_LARGE_MESSAGE;
  if (file.size === 0) return 'The file is empty';
  return null;
}
