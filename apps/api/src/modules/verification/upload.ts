import type { NextFunction, Request, Response } from 'express';
import { fileTypeFromBuffer } from 'file-type';
import { imageSize } from 'image-size';
import multer from 'multer';
import {
  PHOTO_CONTENT_TYPES,
  PHOTO_MAX_BYTES,
  PHOTO_TOO_LARGE_MESSAGE,
  PHOTO_UNSUPPORTED_MESSAGE,
  TRAVEL_ATTACHMENT_MAX_BYTES,
  TRAVEL_ATTACHMENT_TOO_LARGE_MESSAGE,
  TRAVEL_ATTACHMENT_UNSUPPORTED_MESSAGE,
} from '@champ/shared';
import { badRequest } from '../../lib/errors';

const fileError = (code: 'VALIDATION_ERROR' | 'FILE_TOO_LARGE' | 'UNSUPPORTED_FILE', message: string) =>
  badRequest(code, message, { fieldErrors: { file: [message] } });

/**
 * Multipart `file` (≤ `maxBytes`) into memory. Multer's size limit (otherwise a 413) becomes a friendly 400
 * FILE_TOO_LARGE; a missing file is 400 VALIDATION_ERROR. The text fields land in `req.body`.
 */
function singleFileUpload(maxBytes: number, messages: { tooLarge: string; missing: string }) {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes, files: 1 } }).single('file');
  return (req: Request, res: Response, next: NextFunction) => {
    upload(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        return next(err.code === 'LIMIT_FILE_SIZE' ? fileError('FILE_TOO_LARGE', messages.tooLarge) : fileError('VALIDATION_ERROR', err.message));
      }
      if (err) return next(err);
      if (!req.file) return next(fileError('VALIDATION_ERROR', messages.missing));
      next();
    });
  };
}

/** A photo upload (F06): one image, up to 10 MB. */
export const uploadPhoto = singleFileUpload(PHOTO_MAX_BYTES, { tooLarge: PHOTO_TOO_LARGE_MESSAGE, missing: 'Choose an image to upload' });

/** A travel receipt upload (F08): one image or PDF, up to 10 MB. */
export const uploadReceipt = singleFileUpload(TRAVEL_ATTACHMENT_MAX_BYTES, {
  tooLarge: TRAVEL_ATTACHMENT_TOO_LARGE_MESSAGE,
  missing: 'Choose an image or PDF to upload',
});

export interface InspectedImage {
  contentType: (typeof PHOTO_CONTENT_TYPES)[number];
  ext: 'jpg' | 'png' | 'webp';
  width: number | null;
  height: number | null;
}

const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;

/** Reads width and height from an image header (`image-size`, pure JS); an unreadable header is UNSUPPORTED_FILE. */
function imageDimensions(body: Buffer): { width: number | null; height: number | null } {
  try {
    const size = imageSize(body);
    return { width: size.width ?? null, height: size.height ?? null };
  } catch {
    throw fileError('UNSUPPORTED_FILE', 'The file is not a readable image');
  }
}

/**
 * Checks the real type from the magic bytes (`file-type`, whatever the name or declared type says): only
 * JPEG, PNG and WebP, else 400 UNSUPPORTED_FILE. Width and height come from the header (`image-size`, pure JS).
 */
export async function inspectImage(body: Buffer): Promise<InspectedImage> {
  const type = await fileTypeFromBuffer(body);
  const contentType = PHOTO_CONTENT_TYPES.find((t) => t === type?.mime);
  if (!contentType) throw fileError('UNSUPPORTED_FILE', PHOTO_UNSUPPORTED_MESSAGE);
  return { contentType, ext: EXTENSIONS[contentType], ...imageDimensions(body) };
}

export interface InspectedAttachment {
  contentType: InspectedImage['contentType'] | 'application/pdf';
  ext: InspectedImage['ext'] | 'pdf';
  width: number | null;
  height: number | null;
}

/**
 * A travel receipt (F08): JPEG, PNG, WebP or PDF by magic bytes (whatever the name or declared type says), else
 * 400 UNSUPPORTED_FILE. Images get their size from the header; PDFs have none.
 */
export async function inspectAttachment(body: Buffer): Promise<InspectedAttachment> {
  const type = await fileTypeFromBuffer(body);
  if (type?.mime === 'application/pdf') return { contentType: 'application/pdf', ext: 'pdf', width: null, height: null };
  const contentType = PHOTO_CONTENT_TYPES.find((t) => t === type?.mime);
  if (!contentType) throw fileError('UNSUPPORTED_FILE', TRAVEL_ATTACHMENT_UNSUPPORTED_MESSAGE);
  return { contentType, ext: EXTENSIONS[contentType], ...imageDimensions(body) };
}
