import type { NextFunction, Request, Response } from 'express';
import type { z } from 'zod';

interface Schemas {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
}

/**
 * Parses request parts with zod and replaces them with the parsed values.
 * Validation errors (ZodError) are turned into 400 responses by the error handler.
 */
export function validate(schemas: Schemas) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (schemas.body) req.body = schemas.body.parse(req.body ?? {});
    if (schemas.params) req.params = schemas.params.parse(req.params) as Request['params'];
    if (schemas.query) {
      // Express 5 exposes req.query as a getter, so redefine it with the parsed value.
      Object.defineProperty(req, 'query', { value: schemas.query.parse(req.query), writable: true });
    }
    next();
  };
}
