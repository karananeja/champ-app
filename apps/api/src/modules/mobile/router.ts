import { Router, type RequestHandler, type Response } from 'express';
import {
  MOBILE_ROLES,
  loginSchema,
  mobileDateQuerySchema,
  mobileRefreshSchema,
  recalculateRouteSchema,
  routeQuerySchema,
  type LoginInput,
  type MobileAuthResponse,
  type MobileDateQuery,
  type MobileRefreshInput,
  type RecalculateRouteInput,
  type RouteQuery,
  fitmentFormSchema,
  uploadTechnicianPhotoSchema,
  type FitmentFormInput,
  type UploadTechnicianPhotoInput,
} from '@champ/shared';
import type { RouteOptimizer } from '../../lib/router';
import type { Storage } from '../../lib/storage';
import { authenticate, currentUser } from '../../middleware/auth';
import { requireRole } from '../../middleware/require-role';
import { validate } from '../../middleware/validate';
import * as auth from '../auth/service';
import { uploadPhoto } from '../verification/upload';
import { saveForm, technicianUploadGuard, uploadTechnicianPhoto } from './form';
import { getDayRoute } from './route';
import * as mobile from './service';

const mobileOnly = { roles: MOBILE_ROLES };

/** Sends the session in the body (no cookie): the app keeps the refresh token in SecureStore (D-133). */
function sendMobileSession(res: Response, session: auth.Session) {
  const body: MobileAuthResponse = { accessToken: session.accessToken, refreshToken: session.refreshToken, user: session.user };
  res.json(body);
}

/** `/mobile/*`: the field app's sign-in (OT and OE only, D-128), its home and task list (F09) and day route (F10). */
export function mobileRouter(loginLimiter: RequestHandler, optimizer: RouteOptimizer, storage: Storage) {
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

  app.get('/fitments/:fid', async (req, res) => {
    res.json(await mobile.getMyFitment(storage, currentUser(req), req.params.fid as string));
  });

  // F10B: the technician's form (partial autosave) and photos.
  app.put('/fitments/:fid/form', validate({ body: fitmentFormSchema }), async (req, res) => {
    const fid = req.params.fid as string;
    await saveForm(currentUser(req), fid, req.body as FitmentFormInput);
    res.json(await mobile.getMyFitment(storage, currentUser(req), fid));
  });

  // The role (above) and the fitment rule are checked before multer reads the file (D-108).
  app.post('/fitments/:fid/photos', technicianUploadGuard, uploadPhoto, validate({ body: uploadTechnicianPhotoSchema }), async (req, res) => {
    const photo = await uploadTechnicianPhoto(storage, currentUser(req), req.params.fid as string, req.file!, req.body as UploadTechnicianPhotoInput);
    res.status(201).json(photo);
  });

  app.get('/route', validate({ query: routeQuerySchema }), async (req, res) => {
    const { date, lat, lng } = req.query as unknown as RouteQuery;
    const gps = lat !== undefined && lng !== undefined ? { lat, lng } : undefined;
    res.json(await getDayRoute(currentUser(req), date, { gps }, optimizer));
  });

  app.post('/route/recalculate', validate({ body: recalculateRouteSchema }), async (req, res) => {
    const { date, lat, lng } = req.body as RecalculateRouteInput;
    res.json(await getDayRoute(currentUser(req), date, { gps: { lat, lng }, force: true }, optimizer));
  });

  router.use(app);
  return router;
}
