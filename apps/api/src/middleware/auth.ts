import type { NextFunction, Request, Response } from 'express';
import { unauthorized } from '../lib/errors';
import { verifyAccessToken } from '../lib/jwt';
import { prisma, type User } from '../lib/prisma';

/**
 * Verifies the bearer access token and loads the user. The user is re-read on
 * every request so deactivation and role changes take effect immediately.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!token) throw unauthorized();

  const payload = verifyAccessToken(token);
  if (!payload) throw unauthorized('UNAUTHENTICATED', 'Invalid or expired access token');

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || user.status !== 'ACTIVE') throw unauthorized('UNAUTHENTICATED', 'Account not available');

  req.user = user;
  next();
}

/** Returns the authenticated user; use only behind `authenticate`. */
export function currentUser(req: Request): User {
  if (!req.user) throw unauthorized();
  return req.user;
}
