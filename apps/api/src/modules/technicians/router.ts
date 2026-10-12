import { Router } from 'express';
import {
  TECHNICIAN_CREATE_ROLES,
  TECHNICIAN_LIST_ROLES,
  createTechnicianSchema,
  listTechniciansQuerySchema,
  updateTechnicianSchema,
  type CreateTechnicianInput,
  type ListTechniciansQuery,
  type UpdateTechnicianInput,
} from '@champ/shared';
import { authenticate, currentUser } from '../../middleware/auth';
import { requireRole } from '../../middleware/require-role';
import { validate } from '../../middleware/validate';
import * as technicians from './service';

/** `/technicians`: OT profiles (type, base location) on top of F01 users and invites. */
export function techniciansRouter() {
  const router = Router();
  router.use(authenticate);

  router.get(
    '/',
    requireRole(...TECHNICIAN_LIST_ROLES),
    validate({ query: listTechniciansQuerySchema }),
    async (req, res) => {
      res.json(await technicians.listTechnicians(currentUser(req), req.query as unknown as ListTechniciansQuery));
    },
  );

  router.post(
    '/',
    requireRole(...TECHNICIAN_CREATE_ROLES),
    validate({ body: createTechnicianSchema }),
    async (req, res) => {
      res.status(201).json(await technicians.createTechnician(currentUser(req), req.body as CreateTechnicianInput));
    },
  );

  // canManageTechnician is checked in the service (it needs the target technician).
  router.patch('/:id', requireRole('SUPER_ADMIN', 'OM', 'OE'), validate({ body: updateTechnicianSchema }), async (req, res) => {
    res.json(
      await technicians.updateTechnician(currentUser(req), req.params.id as string, req.body as UpdateTechnicianInput),
    );
  });

  return router;
}
