import { Router } from 'express';
import {
  USER_LIST_ROLES,
  delegationSchema,
  listUsersQuerySchema,
  managersQuerySchema,
  updateUserSchema,
  type DelegationInput,
  type ListUsersQuery,
  type ManagersQuery,
  type UpdateUserInput,
} from '@champ/shared';
import { authenticate, currentUser } from '../../middleware/auth';
import { requireRole } from '../../middleware/require-role';
import { validate } from '../../middleware/validate';
import * as users from './service';

/** Mounted at `/api`: provides `/me` and `/users/*`. */
export function usersRouter() {
  const router = Router();

  router.get('/me', authenticate, async (req, res) => {
    res.json(await users.getMe(currentUser(req)));
  });

  router.use('/users', usersSubRouter());
  return router;
}

function usersSubRouter() {
  const router = Router();
  router.use(authenticate);

  router.get(
    '/managers',
    requireRole('SUPER_ADMIN', 'OM', 'OE'),
    validate({ query: managersQuerySchema }),
    async (req, res) => {
      res.json({ items: await users.listManagerCandidates(currentUser(req), req.query as unknown as ManagersQuery) });
    },
  );

  router.get('/', requireRole(...USER_LIST_ROLES), validate({ query: listUsersQuerySchema }), async (req, res) => {
    res.json(await users.listUsers(currentUser(req), req.query as unknown as ListUsersQuery));
  });

  router.get('/:id', requireRole(...USER_LIST_ROLES), async (req, res) => {
    res.json(await users.getUser(currentUser(req), req.params.id as string));
  });

  router.patch('/:id', requireRole('SUPER_ADMIN', 'OM'), validate({ body: updateUserSchema }), async (req, res) => {
    res.json(await users.updateUser(currentUser(req), req.params.id as string, req.body as UpdateUserInput));
  });

  router.patch(
    '/:id/delegation',
    requireRole('SUPER_ADMIN'),
    validate({ body: delegationSchema }),
    async (req, res) => {
      res.json(await users.updateDelegation(req.params.id as string, req.body as DelegationInput));
    },
  );

  return router;
}
