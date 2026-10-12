import { Router, type Request } from 'express';
import {
  type Role,
  APPROVER_ROLES,
  PHOTO_MANAGER_ROLES,
  TASK_VIEW_ROLES,
  fitmentLookupQuerySchema,
  type FitmentLookupQuery,
  WORKFLOW_VIEW_ROLES,
  approveFitmentsSchema,
  photoListQuerySchema,
  removePhotoSchema,
  replacePhotoSchema,
  transitionSchema,
  updateVerificationSchema,
  uploadPhotoSchema,
  workflowListQuerySchema,
  type ApproveFitmentsInput,
  type PhotoChangeInput,
  type PhotoListQuery,
  type TransitionInput,
  type UpdateVerificationInput,
  type WorkflowListQuery,
} from '@champ/shared';
import type { Storage } from '../../lib/storage';
import { authenticate, currentUser } from '../../middleware/auth';
import { requireRole } from '../../middleware/require-role';
import { validate } from '../../middleware/validate';
import { approveMany, transitionFitment } from './engine';
import { listWorkflowFitments, type WorkflowList } from './lists';
import { listPhotos, removePhoto, replacePhoto, uploadDebugPhoto } from '../verification/photos';
import { saveVerification } from '../verification/service';
import { lookupFitments } from '../travel/fitment-lookup';
import { uploadPhoto } from '../verification/upload';

const query = (req: Request) => req.query as unknown as WorkflowListQuery;

const fid = (req: Request) => req.params.fid as string;

/**
 * `/fitments` (F05), outside the `/tasks` router so that OTs can act on their own fitments (D-077). Who may
 * do what is decided by the shared state machine in the engine; the lists have role guards. F06 adds the
 * verification draft save and the photos (stored through `storage`).
 */
export function fitmentsRouter(storage: Storage) {
  const router = Router();
  router.use(authenticate);

  const list = (name: WorkflowList, roles: readonly Role[]) =>
    router.get(`/${name}`, requireRole(...roles), validate({ query: workflowListQuerySchema }), async (req, res) => {
      res.json(await listWorkflowFitments(currentUser(req), name, query(req)));
    });
  list('awaiting-approval', APPROVER_ROLES);
  list('reopened', WORKFLOW_VIEW_ROLES);
  list('faulty', WORKFLOW_VIEW_ROLES);

  // F08: the related-task combobox of the travel form (SA, OM, OE, RO).
  router.get('/lookup', requireRole(...TASK_VIEW_ROLES), validate({ query: fitmentLookupQuerySchema }), async (req, res) => {
    res.json(await lookupFitments((req.query as unknown as FitmentLookupQuery).q));
  });

  router.post('/approve', requireRole(...APPROVER_ROLES), validate({ body: approveFitmentsSchema }), async (req, res) => {
    res.json(await approveMany(currentUser(req), (req.body as ApproveFitmentsInput).fitmentIds));
  });

  router.post('/:fid/transitions', validate({ body: transitionSchema }), async (req, res) => {
    const { action, payload } = req.body as TransitionInput;
    res.json(await transitionFitment(currentUser(req), req.params.fid as string, action, payload ?? {}));
  });

  // --- F06: verification and photos ---
  router.put('/:fid/verification', validate({ body: updateVerificationSchema }), async (req, res) => {
    res.json(await saveVerification(currentUser(req), fid(req), req.body as UpdateVerificationInput));
  });
  router.get('/:fid/photos', validate({ query: photoListQuerySchema }), async (req, res) => {
    res.json(await listPhotos(storage, currentUser(req), fid(req), (req.query as unknown as PhotoListQuery).history ?? false));
  });
  router.post('/:fid/photos', requireRole(...PHOTO_MANAGER_ROLES), uploadPhoto, validate({ body: uploadPhotoSchema }), async (req, res) => {
    res.status(201).json({ photo: await uploadDebugPhoto(storage, currentUser(req), fid(req), req.file!) });
  });
  router.post('/:fid/photos/:pid/replace', requireRole(...PHOTO_MANAGER_ROLES), uploadPhoto, validate({ body: replacePhotoSchema }), async (req, res) => {
    const { reason } = req.body as PhotoChangeInput;
    res.status(201).json({ photo: await replacePhoto(storage, currentUser(req), fid(req), req.params.pid as string, req.file!, reason) });
  });
  router.post('/:fid/photos/:pid/remove', validate({ body: removePhotoSchema }), async (req, res) => {
    await removePhoto(currentUser(req), fid(req), req.params.pid as string, (req.body as PhotoChangeInput).reason);
    res.status(204).end();
  });

  return router;
}
