import { Router } from 'express';
import {
  TASK_VIEW_ROLES,
  globalSearchQuerySchema,
  updateSearchIdentifiersSchema,
  type GlobalSearchQuery,
  type UpdateSearchIdentifiersInput,
} from '@champ/shared';
import { authenticate, currentUser } from '../../middleware/auth';
import { requireRole } from '../../middleware/require-role';
import { validate } from '../../middleware/validate';
import { globalSearch } from './service';
import { getSearchIdentifiers, updateSearchIdentifiers } from './settings';

/** `/search` (F14): global search for task viewers (OT gets 403); the identifier list for the SA only. */
export function searchRouter() {
  const router = Router();
  router.use(authenticate);

  router.get('/', requireRole(...TASK_VIEW_ROLES), validate({ query: globalSearchQuerySchema }), async (req, res) => {
    res.json(await globalSearch(currentUser(req), req.query as unknown as GlobalSearchQuery));
  });
  router.get('/identifiers', requireRole('SUPER_ADMIN'), async (_req, res) => {
    res.json(await getSearchIdentifiers());
  });
  router.put('/identifiers', requireRole('SUPER_ADMIN'), validate({ body: updateSearchIdentifiersSchema }), async (req, res) => {
    res.json(await updateSearchIdentifiers(req.body as UpdateSearchIdentifiersInput));
  });
  return router;
}
