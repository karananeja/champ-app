import { Router } from 'express';
import { canManageTask, formatTkId, simulateSchema, type SimulateInput, type TransitionPayload } from '@champ/shared';
import { conflict, forbidden, notFound } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { authenticate, currentUser } from '../../middleware/auth';
import { requireRole } from '../../middleware/requireRole';
import { validate } from '../../middleware/validate';
import { transitionFitment } from './engine';

/**
 * Dev-only technician simulator (D-073): `POST /dev/fitments/:fid/simulate` performs a technician step as the
 * fitment's assigned technician, so the OT steps can be tested before the mobile app (F10). Mounted only when
 * enabled (never in production); the caller must be SA, OM or the task's OE. START defaults to the site's
 * coordinates. Events are flagged `simulated: true`.
 */
export function devSimulatorRouter() {
  const router = Router();
  router.use(authenticate, requireRole('SUPER_ADMIN', 'OM', 'OE'));

  router.post('/fitments/:fid/simulate', validate({ body: simulateSchema }), async (req, res) => {
    const caller = currentUser(req);
    const { action, payload } = req.body as SimulateInput;
    const fitment = await prisma.fitment.findUnique({
      where: { id: req.params.fid as string },
      include: { technician: true, task: { select: { oeId: true, deletedAt: true, site: { select: { lat: true, lng: true } } } } },
    });
    if (!fitment || fitment.task.deletedAt) throw notFound('Fitment not found');
    if (!canManageTask(caller, fitment.task)) throw forbidden('FORBIDDEN', "Only an OM or the task's operation executive can simulate its technician");
    if (!fitment.technician) {
      throw conflict('INVALID_TRANSITION', `Assign a technician to ${formatTkId(fitment.tkNo)} before simulating their steps`);
    }
    const body: TransitionPayload =
      action === 'START' ? { lat: fitment.task.site.lat, lng: fitment.task.site.lng, ...payload } : { ...payload };
    res.json(await transitionFitment(fitment.technician, fitment.id, action, body, { simulated: true, viewer: caller }));
  });

  return router;
}
