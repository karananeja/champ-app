import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { FITMENT_CHECKS, TECHNICIAN_PHOTO_KINDS, canManageTask, type PhotoKind, formatTkId, simulateSchema, type SimulateInput, type TransitionPayload } from '@champ/shared';
import type { Prisma } from '../../generated/prisma/client';
import { conflict, forbidden, notFound } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { prisma, type User } from '../../lib/prisma';
import type { Storage } from '../../lib/storage';
import { writeEvent } from '../tasks/events';
import { SAMPLE_OT_REMARKS, loadSamplePhotos } from '../dev/sample-photos';
import { photoObjectKey } from '../verification/photos';
import { authenticate, currentUser } from '../../middleware/auth';
import { requireRole } from '../../middleware/require-role';
import { validate } from '../../middleware/validate';
import { transitionFitment } from './engine';
import { toFormDto } from '../mobile/form';

/**
 * Dev-only technician simulator (D-073): `POST /dev/fitments/:fid/simulate` performs a technician step as the
 * fitment's assigned technician (an OT, or an OE doing fitments, D-158), so the technician steps can be tested
 * without the mobile app. START follows the stored day-route order when one exists (D-156). Mounted only when
 * enabled (never in production); the caller must be SA, OM or the task's OE. START defaults to the site's
 * coordinates. Events are flagged `simulated: true`. F06: SUBMIT also stores OT remarks and the five sample
 * photos (Before, After, Asset, Cluster, Placement) as the technician, with the site's coordinates.
 */
export function devSimulatorRouter(storage: Storage) {
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
    if (action !== 'SUBMIT') {
      res.json(await transitionFitment(fitment.technician, fitment.id, action, body, { simulated: true, viewer: caller }));
      return;
    }
    // A resubmit after a reopen keeps the photos already there; only missing kinds get a sample (F10B: and the
    // empty required form fields get sample values, so the SUBMIT form check passes).
    const existing = await prisma.fitmentPhoto.findMany({
      where: { fitmentId: fitment.id, status: 'ACTIVE', kind: { in: [...TECHNICIAN_PHOTO_KINDS] } },
      select: { kind: true },
    });
    const have = new Set(existing.map((p) => p.kind));
    const photos = await storeSamplePhotos(storage, fitment.id, (kind) => !have.has(kind));
    try {
      res.json(
        await transitionFitment(fitment.technician, fitment.id, action, body, {
          simulated: true,
          viewer: caller,
          beforeApply: (tx, f) => attachSamples(tx, fitment.technician!, f, photos, fitment.task.site),
        }),
      );
    } catch (err) {
      await Promise.all(photos.map((p) => storage.delete(p.key).catch(() => undefined)));
      throw err;
    }
  });

  return router;
}

type StoredSample = Awaited<ReturnType<typeof loadSamplePhotos>>[number] & { id: string; key: string };

/** Uploads the sample photos before the transaction (objects are cleaned up if it fails). */
async function storeSamplePhotos(storage: Storage, fitmentId: string, wanted: (kind: PhotoKind) => boolean): Promise<StoredSample[]> {
  const samples = (await loadSamplePhotos()).filter((s) => wanted(s.kind));
  const stored: StoredSample[] = [];
  try {
    for (const sample of samples) {
      const id = randomUUID();
      const key = photoObjectKey(fitmentId, id, 'jpg');
      await storage.put(key, sample.body, 'image/jpeg');
      stored.push({ ...sample, id, key });
    }
  } catch (err) {
    logger.error({ err }, 'Simulator: could not store the sample photos');
    await Promise.all(stored.map((p) => storage.delete(p.key).catch(() => undefined)));
    throw err;
  }
  return stored;
}

/** Sample values for the empty required form fields (F10B), like the sample photos. */
async function fillSampleForm(tx: Prisma.TransactionClient, fitmentId: string, tkNo: number) {
  const f = await tx.fitment.findUniqueOrThrow({ where: { id: fitmentId } });
  const form = toFormDto(f);
  const checks = { ...Object.fromEntries(FITMENT_CHECKS.map((c) => [c, 'OK'])), ...form.checks };
  const pad = String(tkNo).padStart(5, '0');
  await tx.fitment.update({
    where: { id: fitmentId },
    data: {
      checks,
      otRemarks: form.comments ?? SAMPLE_OT_REMARKS,
      deviceReplacement: form.deviceReplacement ?? 'DEVICE',
      deviceId: form.deviceId ?? `SIM${pad}`,
      vehicleRegNo: form.vehicleRegNo ?? `KA01SM${pad.slice(-4)}`,
      clusterReadingKm: form.clusterReadingKm ?? 12_345,
      formUpdatedAt: new Date(),
    },
  });
}

/** Inside the SUBMIT transaction, before the form check: the sample form and, when missing, the photo rows and one PHOTO_ADDED event. */
async function attachSamples(
  tx: Prisma.TransactionClient,
  technician: User,
  fitment: { id: string; taskId: string; tkId: string },
  photos: StoredSample[],
  site: { lat: number; lng: number },
) {
  await fillSampleForm(tx, fitment.id, Number(fitment.tkId.slice(3)));
  if (!photos.length) return;
  const now = new Date();
  await tx.fitmentPhoto.createMany({
    data: photos.map((p) => ({
      id: p.id,
      fitmentId: fitment.id,
      kind: p.kind,
      objectKey: p.key,
      contentType: 'image/jpeg',
      sizeBytes: p.body.length,
      width: p.width,
      height: p.height,
      originalName: p.fileName,
      takenAt: now,
      lat: site.lat,
      lng: site.lng,
      uploadedById: technician.id,
      source: 'SIMULATOR' as const,
    })),
  });
  await writeEvent(tx, technician, {
    taskId: fitment.taskId,
    fitmentId: fitment.id,
    type: 'PHOTO_ADDED',
    data: { tkId: fitment.tkId, photoIds: photos.map((p) => p.id), kinds: photos.map((p) => p.kind), simulated: true },
  });
}
