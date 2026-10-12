import { Router } from 'express';
import {
  MOBILE_ROLES,
  USER_LIST_ROLES,
  setHomeLocationSchema,
  delegationSchema,
  listUsersQuerySchema,
  managersQuerySchema,
  updateUserSchema,
  type DelegationInput,
  type ListUsersQuery,
  type ManagersQuery,
  type SetHomeLocationInput,
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

  // F09 / D-129: only the user themselves sets it, and only OT and OE have one.
  router.put(
    '/me/home-location',
    authenticate,
    requireRole(...MOBILE_ROLES),
    validate({ body: setHomeLocationSchema }),
    async (req, res) => {
      res.json(await users.setHomeLocation(currentUser(req), req.body as SetHomeLocationInput));
    },
  );

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
