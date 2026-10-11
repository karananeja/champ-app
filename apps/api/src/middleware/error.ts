import type { NextFunction, Request, Response } from 'express';
import { ZodError, z } from 'zod';
import type { ApiErrorBody } from '@champ/shared';
import { HttpError } from '../lib/errors';
import { logger } from '../lib/logger';

export function notFoundHandler(_req: Request, res: Response) {
  const body: ApiErrorBody = { error: { code: 'NOT_FOUND', message: 'Route not found' } };
  res.status(404).json(body);
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  let status = 500;
  let body: ApiErrorBody = { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } };

  if (err instanceof HttpError) {
    status = err.status;
    body = { error: { code: err.code, message: err.message, details: err.details } };
  } else if (err instanceof ZodError) {
    status = 400;
    const { formErrors, fieldErrors } = z.flattenError(err);
    body = {
      error: {
        code: 'VALIDATION_ERROR',
        message: formErrors[0] ?? 'Invalid request',
        details: { fieldErrors, formErrors },
      },
    };
  } else if (isBodyParserError(err)) {
    status = 400;
    body = { error: { code: 'VALIDATION_ERROR', message: 'Malformed request body' } };
  } else {
    logger.error({ err }, 'Unhandled error');
  }

  res.status(status).json(body);
}

function isBodyParserError(err: unknown): boolean {
  return err instanceof SyntaxError && 'type' in err && err.type === 'entity.parse.failed';
}
