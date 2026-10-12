import { Router, type Request } from 'express';
import { notificationListQuerySchema } from '@champ/shared';
import type { z } from 'zod';
import { authenticate, currentUser } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { listNotifications, markAllRead, markRead, unreadCount } from './service';

/** `/notifications` (F13): any signed-in user, own notifications only. Fixed paths come before `/:id`. */
export function notificationsRouter() {
  const router = Router();
  router.use(authenticate);

  router.get('/', validate({ query: notificationListQuerySchema }), async (req, res) => {
    res.json(await listNotifications(currentUser(req).id, req.query as unknown as z.infer<typeof notificationListQuerySchema>));
  });
  router.get('/unread-count', async (req, res) => {
    res.json({ unreadCount: await unreadCount(currentUser(req).id) });
  });
  router.post('/read-all', async (req, res) => {
    await markAllRead(currentUser(req).id);
    res.status(204).end();
  });
  router.post('/:id/read', async (req: Request, res) => {
    await markRead(currentUser(req).id, req.params.id as string);
    res.status(204).end();
  });
  return router;
}
