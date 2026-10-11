import { Router, type NextFunction, type Request, type Response } from 'express';
import {
  MASTERS_VIEW_ROLES,
  activityListQuerySchema,
  canEditLookupKind,
  canEditMasters,
  createActivitySchema,
  createLocationSchema,
  createLookupItemSchema,
  createMakeModelSchema,
  locationListQuerySchema,
  lookupKindFromSlug,
  masterListQuerySchema,
  updateActivitySchema,
  updateLocationSchema,
  updateLookupItemSchema,
  updateMakeModelSchema,
  type ActivityListQuery,
  type CreateActivityInput,
  type CreateLocationInput,
  type CreateLookupItemInput,
  type CreateMakeModelInput,
  type LocationListQuery,
  type LookupKind,
  type MasterListQuery,
  type UpdateActivityInput,
  type UpdateLocationInput,
  type UpdateLookupItemInput,
  type UpdateMakeModelInput,
} from '@champ/shared';
import { forbidden, notFound } from '../../lib/errors';
import { authenticate, currentUser } from '../../middleware/auth';
import { requireRole } from '../../middleware/require-role';
import { validate } from '../../middleware/validate';
import { getLookups } from './lookups';
import * as masters from './service';

/** `GET /lookups`: active values of every master, for any signed-in user. */
export function lookupsRouter() {
  const router = Router();
  router.get('/', authenticate, async (_req, res) => {
    res.json(await getLookups());
  });
  return router;
}

function kindParam(req: Request): LookupKind {
  const kind = lookupKindFromSlug(req.params.kind as string);
  if (!kind) throw notFound('Unknown master');
  return kind;
}

const id = (req: Request) => req.params.id as string;

/** Rejects writes early (before body validation) for users without edit rights on the master. */
function canWrite(req: Request, _res: Response, next: NextFunction) {
  const actor = currentUser(req);
  const allowed = req.params.kind ? canEditLookupKind(actor, kindParam(req)) : canEditMasters(actor);
  if (!allowed) throw forbidden();
  next();
}

/**
 * `/masters/*`: admin CRUD, for SA and OM only (D-059): other roles get 403 on every route, reads included,
 * and use `GET /lookups` for dropdown values. Write permissions (canEditMasters / canEditTaskTypes) are
 * checked by `canWrite` and again in the service.
 */
export function mastersRouter() {
  const router = Router();
  router.use(authenticate, requireRole(...MASTERS_VIEW_ROLES));

  // Simple masters (LookupItem), e.g. /masters/lookup/final-issue
  router.get('/lookup/:kind', validate({ query: masterListQuerySchema }), async (req, res) => {
    res.json({ items: await masters.listLookupItems(kindParam(req), req.query as unknown as MasterListQuery) });
  });
  router.post('/lookup/:kind', canWrite, validate({ body: createLookupItemSchema }), async (req, res) => {
    const item = await masters.createLookupItem(currentUser(req), kindParam(req), req.body as CreateLookupItemInput);
    res.status(201).json(item);
  });
  router.patch('/lookup/:kind/:id', canWrite, validate({ body: updateLookupItemSchema }), async (req, res) => {
    res.json(
      await masters.updateLookupItem(currentUser(req), kindParam(req), id(req), req.body as UpdateLookupItemInput),
    );
  });

  router.get('/activities', validate({ query: activityListQuerySchema }), async (req, res) => {
    res.json({ items: await masters.listActivities(req.query as unknown as ActivityListQuery) });
  });
  router.post('/activities', canWrite, validate({ body: createActivitySchema }), async (req, res) => {
    res.status(201).json(await masters.createActivity(currentUser(req), req.body as CreateActivityInput));
  });
  router.patch('/activities/:id', canWrite, validate({ body: updateActivitySchema }), async (req, res) => {
    res.json(await masters.updateActivity(currentUser(req), id(req), req.body as UpdateActivityInput));
  });

  router.get('/make-models', validate({ query: masterListQuerySchema }), async (req, res) => {
    res.json({ items: await masters.listMakeModels(req.query as unknown as MasterListQuery) });
  });
  router.post('/make-models', canWrite, validate({ body: createMakeModelSchema }), async (req, res) => {
    res.status(201).json(await masters.createMakeModel(currentUser(req), req.body as CreateMakeModelInput));
  });
  router.patch('/make-models/:id', canWrite, validate({ body: updateMakeModelSchema }), async (req, res) => {
    res.json(await masters.updateMakeModel(currentUser(req), id(req), req.body as UpdateMakeModelInput));
  });

  router.get('/locations', validate({ query: locationListQuerySchema }), async (req, res) => {
    res.json({ items: await masters.listLocations(req.query as unknown as LocationListQuery) });
  });
  router.post('/locations', canWrite, validate({ body: createLocationSchema }), async (req, res) => {
    res.status(201).json(await masters.createLocation(currentUser(req), req.body as CreateLocationInput));
  });
  router.patch('/locations/:id', canWrite, validate({ body: updateLocationSchema }), async (req, res) => {
    res.json(await masters.updateLocation(currentUser(req), id(req), req.body as UpdateLocationInput));
  });

  return router;
}
