import { Router, type Request } from 'express';
import {
  CLIENT_EDIT_ROLES,
  CLIENT_VIEW_ROLES,
  createClientSchema,
  createSiteSchema,
  listClientsQuerySchema,
  updateClientSchema,
  updateSiteSchema,
  type CreateClientInput,
  type CreateSiteInput,
  type ListClientsQuery,
  type UpdateClientInput,
  type UpdateSiteInput,
} from '@champ/shared';
import { authenticate, currentUser } from '../../middleware/auth';
import { requireRole } from '../../middleware/require-role';
import { validate } from '../../middleware/validate';
import * as clients from './service';

const id = (req: Request) => req.params.id as string;

/**
 * `/clients`: clients and their sites. Reads for SA, OM, OE and RO; writes for SA and OM (canEditClients),
 * checked before body validation (403 before 400, as for masters).
 */
export function clientsRouter() {
  const router = Router();
  router.use(authenticate);
  const canRead = requireRole(...CLIENT_VIEW_ROLES);
  const canWrite = requireRole(...CLIENT_EDIT_ROLES);

  router.get('/', canRead, validate({ query: listClientsQuerySchema }), async (req, res) => {
    res.json(await clients.listClients(req.query as unknown as ListClientsQuery));
  });
  router.get('/:id', canRead, async (req, res) => {
    res.json(await clients.getClient(id(req)));
  });
  router.post('/', canWrite, validate({ body: createClientSchema }), async (req, res) => {
    res.status(201).json(await clients.createClient(currentUser(req), req.body as CreateClientInput));
  });
  router.patch('/:id', canWrite, validate({ body: updateClientSchema }), async (req, res) => {
    res.json(await clients.updateClient(currentUser(req), id(req), req.body as UpdateClientInput));
  });

  router.post('/:id/sites', canWrite, validate({ body: createSiteSchema }), async (req, res) => {
    res.status(201).json(await clients.addSite(currentUser(req), id(req), req.body as CreateSiteInput));
  });
  router.patch('/:id/sites/:siteId', canWrite, validate({ body: updateSiteSchema }), async (req, res) => {
    res.json(
      await clients.updateSite(currentUser(req), id(req), req.params.siteId as string, req.body as UpdateSiteInput),
    );
  });

  return router;
}
