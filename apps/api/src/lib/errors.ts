import type { ErrorCode } from '@champ/shared';

/** An error that maps directly to an HTTP response `{ error: { code, message, details? } }`. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (code: ErrorCode, message: string, details?: unknown) =>
  new HttpError(400, code, message, details);
export const unauthorized = (code: ErrorCode = 'UNAUTHENTICATED', message = 'Authentication required') =>
  new HttpError(401, code, message);
export const forbidden = (code: ErrorCode = 'FORBIDDEN', message = 'You are not allowed to do this') =>
  new HttpError(403, code, message);
export const notFound = (message = 'Not found') => new HttpError(404, 'NOT_FOUND', message);
export const conflict = (code: ErrorCode, message: string) => new HttpError(409, code, message);
export const gone = (code: ErrorCode, message: string) => new HttpError(410, code, message);
