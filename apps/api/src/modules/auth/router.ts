import { Router, type Request, type RequestHandler, type Response } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { googleLoginSchema, loginSchema, type ApiErrorBody, type AuthResponse } from '@champ/shared';
import { REFRESH_COOKIE, clearRefreshCookie, setRefreshCookie } from '../../lib/cookies';
import type { GoogleAuth } from '../../lib/google';
import { validate } from '../../middleware/validate';
import * as auth from './service';

/** Sets the refresh cookie and sends `{ accessToken, user }`. */
export function sendSession(res: Response, session: auth.Session, status = 200) {
  setRefreshCookie(res, session.refreshToken);
  const body: AuthResponse = { accessToken: session.accessToken, user: session.user };
  res.status(status).json(body);
}

function readRefreshCookie(req: Request): string | undefined {
  const value: unknown = req.cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' ? value : undefined;
}

/**
 * 10 password logins per 15 minutes per IP + email. One instance is shared by `/auth/login` and
 * `/mobile/auth/login` (F09), so the limit counts across web and mobile.
 */
export function createLoginLimiter(): RequestHandler {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      return `${ipKeyGenerator(req.ip ?? 'unknown')}|${email}`;
    },
    handler: (_req, res) => {
      const body: ApiErrorBody = {
        error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Try again in 15 minutes.' },
      };
      res.status(429).json(body);
    },
  });
}

export function authRouter(google: GoogleAuth, loginLimiter: RequestHandler = createLoginLimiter()) {
  const router = Router();

  router.post('/login', loginLimiter, validate({ body: loginSchema }), async (req, res) => {
    const { email, password } = req.body as { email: string; password: string };
    sendSession(res, await auth.loginWithPassword(email, password));
  });

  router.post('/google', validate({ body: googleLoginSchema }), async (req, res) => {
    const { idToken } = req.body as { idToken: string };
    sendSession(res, await auth.loginWithGoogle(google, idToken));
  });

  router.post('/refresh', async (req, res) => {
    try {
      sendSession(res, await auth.refreshSession(readRefreshCookie(req)));
    } catch (err) {
      clearRefreshCookie(res);
      throw err;
    }
  });

  router.post('/logout', async (req, res) => {
    await auth.revokeRefreshToken(readRefreshCookie(req));
    clearRefreshCookie(res);
    res.status(204).end();
  });

  return router;
}
