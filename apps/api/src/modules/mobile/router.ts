import { Router, type RequestHandler, type Response } from 'express';
import {
  MOBILE_ROLES,
  loginSchema,
  mobileDateQuerySchema,
  mobileRefreshSchema,
  type LoginInput,
  type MobileAuthResponse,
  type MobileDateQuery,
  type MobileRefreshInput,
} from '@champ/shared';
import { authenticate, currentUser } from '../../middleware/auth';
import { requireRole } from '../../middleware/require-role';
import { validate } from '../../middleware/validate';
import * as auth from '../auth/service';
import * as mobile from './service';

const mobileOnly = { roles: MOBILE_ROLES };

/** Sends the session in the body (no cookie): the app keeps the refresh token in SecureStore (D-133). */
function sendMobileSession(res: Response, session: auth.Session) {
  const body: MobileAuthResponse = { accessToken: session.accessToken, refreshToken: session.refreshToken, user: session.user };
  res.json(body);
}

/** `/mobile/*`: the field app's sign-in (OT and OE only, D-128) and its home and task list (F09). */
export function mobileRouter(loginLimiter: RequestHandler) {
  const router = Router();

  router.post('/auth/login', loginLimiter, validate({ body: loginSchema }), async (req, res) => {
    const { email, password } = req.body as LoginInput;
    sendMobileSession(res, await auth.loginWithPassword(email, password, mobileOnly));
  });

  router.post('/auth/refresh', validate({ body: mobileRefreshSchema }), async (req, res) => {
    const { refreshToken } = req.body as MobileRefreshInput;
    sendMobileSession(res, await auth.refreshSession(refreshToken, mobileOnly));
  });

  router.post('/auth/logout', validate({ body: mobileRefreshSchema }), async (req, res) => {
    await auth.revokeRefreshToken((req.body as MobileRefreshInput).refreshToken);
    res.status(204).end();
  });

  const app = Router();
  app.use(authenticate, requireRole(...MOBILE_ROLES));

  app.get('/home', validate({ query: mobileDateQuerySchema }), async (req, res) => {
    const { date } = req.query as unknown as MobileDateQuery;
    res.json(await mobile.getHome(currentUser(req), date));
  });

  app.get('/fitments', validate({ query: mobileDateQuerySchema }), async (req, res) => {
    const { date } = req.query as unknown as MobileDateQuery;
    res.json(await mobile.listMyFitments(currentUser(req), date));
  });

  router.use(app);
  return router;
}
