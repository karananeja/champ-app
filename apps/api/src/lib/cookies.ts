import type { CookieOptions, Response } from 'express';
import { env } from '../config/env';

export const REFRESH_COOKIE = 'champ_rt';
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const baseOptions: CookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: env.NODE_ENV === 'production',
  path: '/api/auth',
};

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, { ...baseOptions, maxAge: REFRESH_TOKEN_TTL_MS });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, baseOptions);
}
