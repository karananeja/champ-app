import type { NextFunction, Request, Response } from 'express';
import { fileTypeFromBuffer } from 'file-type';
import { imageSize } from 'image-size';
import multer from 'multer';
import {
  PHOTO_CONTENT_TYPES,
  PHOTO_MAX_BYTES,
  PHOTO_TOO_LARGE_MESSAGE,
  PHOTO_UNSUPPORTED_MESSAGE,
} from '@champ/shared';
import { badRequest } from '../../lib/errors';

const fileError = (code: 'VALIDATION_ERROR' | 'FILE_TOO_LARGE' | 'UNSUPPORTED_FILE', message: string) =>
  badRequest(code, message, { fieldErrors: { file: [message] } });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: PHOTO_MAX_BYTES, files: 1 } }).single('file');

/**
 * Multipart `file` (≤ 10 MB) into memory. Multer's size limit (otherwise a 413) becomes a friendly 400
 * FILE_TOO_LARGE; a missing file is 400 VALIDATION_ERROR. The text fields land in `req.body`.
 */
export function uploadPhoto(req: Request, res: Response, next: NextFunction) {
  upload(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      return next(err.code === 'LIMIT_FILE_SIZE' ? fileError('FILE_TOO_LARGE', PHOTO_TOO_LARGE_MESSAGE) : fileError('VALIDATION_ERROR', err.message));
    }
    if (err) return next(err);
    if (!req.file) return next(fileError('VALIDATION_ERROR', 'Choose an image to upload'));
    next();
  });
}

export interface InspectedImage {
  contentType: (typeof PHOTO_CONTENT_TYPES)[number];
  ext: 'jpg' | 'png' | 'webp';
  width: number | null;
  height: number | null;
}

const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;

/**
 * Checks the real type from the magic bytes (`file-type`, whatever the name or declared type says): only
 * JPEG, PNG and WebP, else 400 UNSUPPORTED_FILE. Width and height come from the header (`image-size`, pure JS).
 */
export async function inspectImage(body: Buffer): Promise<InspectedImage> {
  const type = await fileTypeFromBuffer(body);
  const contentType = PHOTO_CONTENT_TYPES.find((t) => t === type?.mime);
  if (!contentType) throw fileError('UNSUPPORTED_FILE', PHOTO_UNSUPPORTED_MESSAGE);
  let size: { width?: number; height?: number };
  try {
    size = imageSize(body);
  } catch {
    throw fileError('UNSUPPORTED_FILE', 'The file is not a readable image');
  }
  return { contentType, ext: EXTENSIONS[contentType], width: size.width ?? null, height: size.height ?? null };
}
