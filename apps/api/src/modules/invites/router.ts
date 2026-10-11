import { Router } from 'express';
import {
  acceptInviteGoogleSchema,
  acceptInviteSchema,
  createInviteSchema,
  inviteLookupQuerySchema,
  type AcceptInviteGoogleInput,
  type AcceptInviteInput,
  type CreateInviteInput,
} from '@champ/shared';
import type { GoogleAuth } from '../../lib/google';
import { authenticate, currentUser } from '../../middleware/auth';
import { requireRole } from '../../middleware/require-role';
import { validate } from '../../middleware/validate';
import { sendSession } from '../auth/router';
import * as invites from './service';

const INVITER_ROLES = ['SUPER_ADMIN', 'OM', 'OE'] as const;

export function invitesRouter(google: GoogleAuth) {
  const router = Router();

  // --- Public (token based) ---

  router.get('/lookup', validate({ query: inviteLookupQuerySchema }), async (req, res) => {
    const { token } = req.query as { token: string };
    res.json(await invites.lookupInvite(token));
  });

  router.post('/accept', validate({ body: acceptInviteSchema }), async (req, res) => {
    sendSession(res, await invites.acceptInvite(req.body as AcceptInviteInput), 201);
  });

  router.post('/accept/google', validate({ body: acceptInviteGoogleSchema }), async (req, res) => {
    const { token, idToken } = req.body as AcceptInviteGoogleInput;
    sendSession(res, await invites.acceptInviteWithGoogle(google, token, idToken), 201);
  });

  // --- Authenticated inviters ---

  router.use(authenticate, requireRole(...INVITER_ROLES));

  router.post('/', validate({ body: createInviteSchema }), async (req, res) => {
    res.status(201).json(await invites.createInvite(currentUser(req), req.body as CreateInviteInput));
  });

  router.get('/', async (req, res) => {
    res.json({ items: await invites.listInvites(currentUser(req)) });
  });

  router.post('/:id/revoke', async (req, res) => {
    res.json(await invites.revokeInvite(currentUser(req), req.params.id as string));
  });

  return router;
}
