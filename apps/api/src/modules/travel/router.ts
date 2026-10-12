import { Router, type Request } from 'express';
import {
  TRAVEL_RAISE_ROLES,
  TRAVEL_VIEW_ROLES,
  createTravelSchema,
  exportTravelQuerySchema,
  listTravelQuerySchema,
  removeTravelAttachmentSchema,
  travelTransitionSchema,
  updateTravelSchema,
  type CreateTravelInput,
  type ExportTravelQuery,
  type ListTravelQuery,
  type RemoveTravelAttachmentInput,
  type TravelTransitionInput,
  type UpdateTravelInput,
} from '@champ/shared';
import type { Storage } from '../../lib/storage';
import { authenticate, currentUser } from '../../middleware/auth';
import { requireRole } from '../../middleware/require-role';
import { validate } from '../../middleware/validate';
import { uploadReceipt } from '../verification/upload';
import { assertCanManageAttachments, removeAttachment, uploadAttachment } from './attachments';
import { exportTravel } from './export';
import { createTravel, getTravel, getTravelOptions, listTravel, transitionTravel, updateTravel } from './service';

const id = (req: Request) => req.params.id as string;

/**
 * `/travel-tasks` (F08). Every route needs a travel viewer (SA, OM, OE, OT, RO); the scope (an OE's technicians,
 * an OT's own) and the per-TT rules are enforced in the service. Raising and receipts need SA, OM, OE or OT;
 * the receipt upload checks the role and the TT rule before the file is read (D-108). Fixed paths come before
 * `/:id`.
 */
export function travelRouter(storage: Storage) {
  const router = Router();
  router.use(authenticate, requireRole(...TRAVEL_VIEW_ROLES));
  const canRaise = requireRole(...TRAVEL_RAISE_ROLES);

  router.get('/options', canRaise, async (req, res) => {
    res.json(await getTravelOptions(currentUser(req)));
  });

  router.get('/export', validate({ query: exportTravelQuerySchema }), async (req, res) => {
    const file = await exportTravel(currentUser(req), req.query as unknown as ExportTravelQuery);
    res.setHeader('Content-Type', file.contentType);
    res.attachment(file.filename);
    res.send(file.body);
  });

  router.get('/', validate({ query: listTravelQuerySchema }), async (req, res) => {
    res.json(await listTravel(currentUser(req), req.query as unknown as ListTravelQuery));
  });
  router.post('/', canRaise, validate({ body: createTravelSchema }), async (req, res) => {
    res.status(201).json(await createTravel(storage, currentUser(req), req.body as CreateTravelInput));
  });
  router.get('/:id', async (req, res) => {
    res.json(await getTravel(storage, currentUser(req), id(req)));
  });
  router.patch('/:id', canRaise, validate({ body: updateTravelSchema }), async (req, res) => {
    res.json(await updateTravel(storage, currentUser(req), id(req), req.body as UpdateTravelInput));
  });
  router.post('/:id/transitions', validate({ body: travelTransitionSchema }), async (req, res) => {
    res.json(await transitionTravel(storage, currentUser(req), id(req), req.body as TravelTransitionInput));
  });

  router.post(
    '/:id/attachments',
    canRaise,
    // Before multer reads the body: someone who may not add receipts here can't push 10 MB into memory.
    async (req, _res, next) => {
      await assertCanManageAttachments(currentUser(req), id(req));
      next();
    },
    uploadReceipt,
    async (req, res) => {
      res.status(201).json({ attachment: await uploadAttachment(storage, currentUser(req), id(req), req.file!) });
    },
  );
  router.post('/:id/attachments/:aid/remove', canRaise, validate({ body: removeTravelAttachmentSchema }), async (req, res) => {
    await removeAttachment(currentUser(req), id(req), req.params.aid as string, (req.body as RemoveTravelAttachmentInput).reason);
    res.status(204).end();
  });

  return router;
}
