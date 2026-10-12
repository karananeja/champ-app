import { randomUUID } from 'node:crypto';
import {
  canManagePhotos,
  canViewPhotoHistory,
  canViewTasks,
  formatTkId,
  isPostApprovalEdit,
  sortPhotos,
  type FitmentPhotoDto,
  type FitmentPhotosResponse,
  type PhotoKind,
  type PhotoSource,
} from '@champ/shared';
import type { Prisma } from '../../generated/prisma/client';
import { HttpError, conflict, forbidden, notFound } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { prisma, type User } from '../../lib/prisma';
import { PHOTO_URL_TTL_SEC, type Storage } from '../../lib/storage';
import { writeEvent } from '../tasks/events';
import { lockTask } from '../tasks/status';
import { assertVerificationEditable } from './service';
import { inspectImage } from './upload';

type Tx = Prisma.TransactionClient;

export const photoInclude = {
  uploadedBy: { select: { id: true, name: true } },
  changedBy: { select: { id: true, name: true } },
} satisfies Prisma.FitmentPhotoInclude;
export type PhotoRow = Prisma.FitmentPhotoGetPayload<{ include: typeof photoInclude }>;

const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

/** A photo with a presigned GET URL (10 minutes). */
export async function toPhotoDto(storage: Storage, p: PhotoRow): Promise<FitmentPhotoDto> {
  return {
    id: p.id,
    fitmentId: p.fitmentId,
    kind: p.kind,
    status: p.status,
    url: await storage.signedGetUrl(p.objectKey, PHOTO_URL_TTL_SEC),
    contentType: p.contentType,
    sizeBytes: p.sizeBytes,
    width: p.width,
    height: p.height,
    originalName: p.originalName,
    takenAt: isoOrNull(p.takenAt),
    lat: p.lat,
    lng: p.lng,
    source: p.source,
    uploadedBy: p.uploadedBy,
    createdAt: p.createdAt.toISOString(),
    replacedById: p.replacedById,
    changeReason: p.changeReason,
    changedBy: p.changedBy,
    changedAt: isoOrNull(p.changedAt),
  };
}

/** Object key of a photo (spec §1). */
export const photoObjectKey = (fitmentId: string, photoId: string, ext: string) => `fitments/${fitmentId}/${photoId}.${ext}`;

/** A fitment of a task that isn't deleted, with what the permission checks need, or 404. */
export async function loadFitment(fitmentId: string, db: Tx = prisma) {
  const fitment = await db.fitment.findUnique({
    where: { id: fitmentId },
    select: { id: true, tkNo: true, status: true, taskId: true, technicianId: true, task: { select: { oeId: true, deletedAt: true } } },
  });
  if (!fitment || fitment.task.deletedAt) throw notFound('Fitment not found');
  return fitment;
}

/**
 * `GET /fitments/:fid/photos`: every task viewer (OT access to their own photos comes with the F10 mobile API).
 * `history` adds replaced and removed photos, for SA, OM and the task's OE only (403 otherwise). Ordered by
 * kind (Before, Asset, Cluster, Placement, After, Debug), then time.
 */
export async function listPhotos(storage: Storage, actor: User, fitmentId: string, history = false): Promise<FitmentPhotosResponse> {
  if (!canViewTasks(actor)) throw forbidden();
  const fitment = await loadFitment(fitmentId);
  const ctx = { task: fitment.task, fitment };
  const canViewHistory = canViewPhotoHistory(actor, ctx);
  if (history && !canViewHistory) throw forbidden('FORBIDDEN', 'Only an operations manager or the task\'s operation executive can see replaced and removed photos');
  const rows = await prisma.fitmentPhoto.findMany({
    where: { fitmentId, ...(history ? {} : { status: 'ACTIVE' }) },
    include: photoInclude,
  });
  const items = await Promise.all(sortPhotos(rows).map((p) => toPhotoDto(storage, p)));
  return { items, canViewHistory, canManage: canManagePhotos(actor, ctx) };
}

const sourceOf = (actor: User): PhotoSource => (actor.role === 'OM' ? 'OM' : actor.role === 'OE' ? 'OE' : 'OT');

/**
 * Uploads the object first, then runs `write` in a transaction that locks the task and the fitment and
 * re-checks the edit locks. If the database part fails, the object is deleted (best effort) and the error
 * is rethrown.
 */
type LoadedFitment = Awaited<ReturnType<typeof loadFitment>>;

export async function storeThenWrite<T>(
  storage: Storage,
  actor: User,
  fitmentId: string,
  file: { buffer: Buffer },
  write: (tx: Tx, fitment: Awaited<ReturnType<typeof loadFitment>>, upload: { id: string; key: string; image: Awaited<ReturnType<typeof inspectImage>> }) => Promise<T>,
  precheck?: () => Promise<unknown>,
  /** The edit rule, checked before the upload and again under the locks (default: the F06 verification lock). */
  assertEditable: (actor: User, fitment: LoadedFitment) => void = (a, f) => assertVerificationEditable(a, f, 'photos'),
): Promise<T> {
  // The file is part of the body, so it is validated before the permission checks (400 before 403, D-081).
  const image = await inspectImage(file.buffer);
  const before = await loadFitment(fitmentId);
  assertEditable(actor, before);
  await precheck?.();
  const id = randomUUID();
  const key = photoObjectKey(fitmentId, id, image.ext);
  try {
    await storage.put(key, file.buffer, image.contentType);
  } catch (err) {
    logger.error({ err, key }, 'Photo upload to storage failed');
    throw new HttpError(503, 'STORAGE_UNAVAILABLE', 'Photo storage is not reachable. Try again in a moment.');
  }
  try {
    return await prisma.$transaction(async (tx) => {
      await lockTask(tx, before.taskId);
      await tx.$queryRaw`SELECT "id" FROM "Fitment" WHERE "id" = ${fitmentId} FOR UPDATE`;
      const fitment = await loadFitment(fitmentId, tx);
      assertEditable(actor, fitment);
      return write(tx, fitment, { id, key, image });
    });
  } catch (err) {
    await storage.delete(key).catch((cleanupErr: unknown) => logger.warn({ err: cleanupErr, key }, 'Could not clean up an orphaned photo'));
    throw err;
  }
}

export const photoData = (
  actor: User,
  fitmentId: string,
  kind: PhotoKind,
  file: { size: number; originalname: string },
  upload: { id: string; key: string; image: Awaited<ReturnType<typeof inspectImage>> },
): Prisma.FitmentPhotoUncheckedCreateInput => ({
  id: upload.id,
  fitmentId,
  kind,
  objectKey: upload.key,
  contentType: upload.image.contentType,
  sizeBytes: file.size,
  width: upload.image.width,
  height: upload.image.height,
  originalName: file.originalname.slice(0, 255) || null,
  uploadedById: actor.id,
  source: sourceOf(actor),
});

export type UploadedFile = { buffer: Buffer; size: number; originalname: string };

/** `POST /fitments/:fid/photos`: an OE/OM debug image (D-032). Technician kinds come from the mobile API (F10). */
export async function uploadDebugPhoto(storage: Storage, actor: User, fitmentId: string, file: UploadedFile): Promise<FitmentPhotoDto> {
  const photo = await storeThenWrite(storage, actor, fitmentId, file, async (tx, fitment, upload) => {
    const created = await tx.fitmentPhoto.create({ data: photoData(actor, fitmentId, 'DEBUG', file, upload), include: photoInclude });
    await writeEvent(tx, actor, {
      taskId: fitment.taskId,
      fitmentId,
      type: 'PHOTO_ADDED',
      data: { tkId: formatTkId(fitment.tkNo), photoId: created.id, kind: 'DEBUG', ...(isPostApprovalEdit(fitment.status) && { postApproval: true }) },
    });
    return created;
  });
  return toPhotoDto(storage, photo);
}

/** The ACTIVE photo of this fitment, or 404 (another fitment's) / 409 (already replaced or removed). */
async function activePhoto(tx: Tx, fitmentId: string, photoId: string) {
  const photo = await tx.fitmentPhoto.findUnique({ where: { id: photoId } });
  if (!photo || photo.fitmentId !== fitmentId) throw notFound('Photo not found');
  if (photo.status !== 'ACTIVE') throw conflict('CONFLICT', `This photo was already ${photo.status === 'REPLACED' ? 'replaced' : 'removed'}`);
  return photo;
}

/**
 * `POST /fitments/:fid/photos/:pid/replace`: the new photo takes the same kind and becomes ACTIVE; the old
 * one is kept as REPLACED, linked to it, with the reason, actor and time (D-100).
 */
export async function replacePhoto(
  storage: Storage,
  actor: User,
  fitmentId: string,
  photoId: string,
  file: UploadedFile,
  reason: string,
): Promise<FitmentPhotoDto> {
  const photo = await storeThenWrite(storage, actor, fitmentId, file, async (tx, fitment, upload) => {
    const old = await activePhoto(tx, fitmentId, photoId);
    const created = await tx.fitmentPhoto.create({ data: photoData(actor, fitmentId, old.kind, file, upload), include: photoInclude });
    await tx.fitmentPhoto.update({
      where: { id: old.id },
      data: { status: 'REPLACED', replacedById: created.id, changeReason: reason, changedById: actor.id, changedAt: new Date() },
    });
    await writeEvent(tx, actor, {
      taskId: fitment.taskId,
      fitmentId,
      type: 'PHOTO_REPLACED',
      data: {
        tkId: formatTkId(fitment.tkNo),
        photoId: old.id,
        replacementId: created.id,
        kind: old.kind,
        reason,
        ...(isPostApprovalEdit(fitment.status) && { postApproval: true }),
      },
    });
    return created;
  }, () => activePhoto(prisma, fitmentId, photoId)); // fail before uploading when the photo is gone
  return toPhotoDto(storage, photo);
}

/** `POST /fitments/:fid/photos/:pid/remove`: status REMOVED with the reason, actor and time; the object stays (D-100). */
export async function removePhoto(actor: User, fitmentId: string, photoId: string, reason: string): Promise<void> {
  const before = await loadFitment(fitmentId);
  assertVerificationEditable(actor, before, 'photos');
  await prisma.$transaction(async (tx) => {
    await lockTask(tx, before.taskId);
    await tx.$queryRaw`SELECT "id" FROM "Fitment" WHERE "id" = ${fitmentId} FOR UPDATE`;
    const fitment = await loadFitment(fitmentId, tx);
    assertVerificationEditable(actor, fitment, 'photos');
    const photo = await activePhoto(tx, fitmentId, photoId);
    await tx.fitmentPhoto.update({
      where: { id: photo.id },
      data: { status: 'REMOVED', changeReason: reason, changedById: actor.id, changedAt: new Date() },
    });
    await writeEvent(tx, actor, {
      taskId: fitment.taskId,
      fitmentId,
      type: 'PHOTO_REMOVED',
      data: {
        tkId: formatTkId(fitment.tkNo),
        photoId: photo.id,
        kind: photo.kind,
        reason,
        ...(isPostApprovalEdit(fitment.status) && { postApproval: true }),
      },
    });
  });
}

