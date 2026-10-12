import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@champ/shared';
import { forbidden } from '../lib/errors';
import { currentUser } from './auth';

export function requireRole(...roles: readonly Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!roles.includes(currentUser(req).role)) throw forbidden();
    next();
  };
}
