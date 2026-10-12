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
  bulkFillConfirmSchema,
  type BulkFillConfirmInput,
  historyQuerySchema,
  type HistoryQuery,
} from '@champ/shared';
import type { RouteOptimizer } from '../../lib/router';
import type { Storage } from '../../lib/storage';
import { authenticate, currentUser } from '../../middleware/auth';
import { requireRole } from '../../middleware/require-role';
import { validate } from '../../middleware/validate';
import * as auth from '../auth/service';
import { uploadPhoto } from '../verification/upload';
import { getApproveVisit, listApproveVisit } from './approve-visit';
import { bulkFillSampleCsv, bulkFillUpload, confirmBulkFill, getBulkFill, previewBulkFill, submitReady } from './bulk-fill';
import { getDayHistory, getReporteesHistory } from './history';
import { saveForm, technicianUploadGuard, uploadTechnicianPhoto } from './form';
import { getDayRoute } from './route';
import * as mobile from './service';

const mobileOnly = { roles: MOBILE_ROLES };

/** Sends the session in the body (no cookie): the app keeps the refresh token in SecureStore (D-133). */
function sendMobileSession(res: Response, session: auth.Session) {
  const body: MobileAuthResponse = { accessToken: session.accessToken, refreshToken: session.refreshToken, user: session.user };
  res.json(body);
}

/**
 * `/mobile/*`: the field app's sign-in (OT and OE only, D-128), its home and task list (F09), day route (F10),
 * history and Approve visit (F12).
 */
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

  // F11: CSV bulk fill of the caller's fitments of one task, and submit the complete ones.
  const taskId = (req: { params: Record<string, unknown> }) => req.params.taskId as string;
  app.get('/tasks/:taskId/bulk-fill', async (req, res) => {
    res.json(await getBulkFill(currentUser(req), taskId(req)));
  });

  app.get('/tasks/:taskId/bulk-fill/sample.csv', async (req, res) => {
    const file = await bulkFillSampleCsv(currentUser(req), taskId(req));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.attachment(file.filename);
    res.send(file.body);
  });

  // The caller-has-fitments check runs before multer reads the file (D-108).
  app.post('/tasks/:taskId/bulk-fill/preview', bulkFillUpload, async (req, res) => {
    res.json(await previewBulkFill(currentUser(req), taskId(req), req.file!.buffer));
  });

  app.post('/tasks/:taskId/bulk-fill/confirm', validate({ body: bulkFillConfirmSchema }), async (req, res) => {
    res.json(await confirmBulkFill(currentUser(req), taskId(req), req.body as BulkFillConfirmInput));
  });

  app.post('/tasks/:taskId/submit-ready', async (req, res) => {
    res.json(await submitReady(currentUser(req), taskId(req)));
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

  // F12: day history with distance, direct reportees, and the OE's Approve visit (VERIFY/REOPEN go through
  // the existing `POST /fitments/:fid/transitions`).
  app.get('/history', validate({ query: historyQuerySchema }), async (req, res) => {
    const { date, userId } = req.query as unknown as HistoryQuery;
    res.json(await getDayHistory(currentUser(req), date, userId, optimizer));
  });

  app.get('/history/reportees', validate({ query: mobileDateQuerySchema }), async (req, res) => {
    const { date } = req.query as unknown as MobileDateQuery;
    res.json(await getReporteesHistory(currentUser(req), date));
  });

  app.get('/approve-visit', validate({ query: mobileDateQuerySchema }), async (req, res) => {
    const { date } = req.query as unknown as MobileDateQuery;
    res.json(await listApproveVisit(currentUser(req), date));
  });

  app.get('/approve-visit/:fid', async (req, res) => {
    res.json(await getApproveVisit(storage, currentUser(req), req.params.fid as string));
  });

  router.use(app);
  return router;
}
