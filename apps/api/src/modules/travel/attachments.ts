import { randomUUID } from 'node:crypto';
import {
  TRAVEL_MAX_ATTACHMENTS,
  canEditTravel,
  canManageTravelAttachments,
  canVerifyTravel,
  formatTtId,
  travelAttachmentLimitMessage,
  travelLockedMessage,
  type TravelAttachmentDto,
} from '@champ/shared';
import type { Prisma } from '../../generated/prisma/client';
import { HttpError, conflict, forbidden, notFound } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { prisma, type User } from '../../lib/prisma';
import type { Storage } from '../../lib/storage';
import { inspectAttachment } from '../verification/upload';
import { toAttachmentDto } from './dto';
import { loadTravelForChange, lockTravel } from './service';

type Tx = Prisma.TransactionClient;

/** Object key of a receipt (spec §1). */
export const attachmentObjectKey = (travelTaskId: string, attachmentId: string, ext: string) => `travel/${travelTaskId}/${attachmentId}.${ext}`;

/**
 * Whether the actor may add or remove receipts on this TT now (`canManageTravelAttachments`): 404 when it doesn't
 * exist, 403 when it's out of scope or the actor is never allowed, 409 TRAVEL_LOCKED when the status is what
 * stops someone who otherwise could (a verified TT). Runs before an upload is read (D-108) and again under the
 * row lock.
 */
export async function assertCanManageAttachments(actor: User, id: string, db: Tx = prisma) {
  const tt = await loadTravelForChange(actor, id, db);
  if (canManageTravelAttachments(actor, tt, tt.technician)) return tt;
  const couldManage = canEditTravel(actor, { ...tt, status: 'RAISED' }) || canVerifyTravel(actor, tt.technician);
  if (couldManage) throw conflict('TRAVEL_LOCKED', travelLockedMessage(formatTtId(tt.ttNo), tt.status));
  throw forbidden('FORBIDDEN', "Only the person who raised this travel task, an operations manager or the technician's operation executive can change its receipts");
}

const uploadedBy = { uploadedBy: { select: { id: true, name: true } } } satisfies Prisma.TravelAttachmentInclude;

/**
 * `POST /travel-tasks/:id/attachments`: one image or PDF (magic bytes), stored first, then recorded under the
 * row lock after re-checking the rule and the 10-receipt cap (409 CONFLICT). If the database part fails the
 * object is deleted (best effort).
 */
export async function uploadAttachment(
  storage: Storage,
  actor: User,
  id: string,
  file: { buffer: Buffer; size: number; originalname: string },
): Promise<TravelAttachmentDto> {
  const inspected = await inspectAttachment(file.buffer);
  const before = await assertCanManageAttachments(actor, id);
  const ttId = formatTtId(before.ttNo);
  if (before.attachments.length >= TRAVEL_MAX_ATTACHMENTS) throw conflict('CONFLICT', travelAttachmentLimitMessage(ttId));

  const attachmentId = randomUUID();
  const key = attachmentObjectKey(id, attachmentId, inspected.ext);
  try {
    await storage.put(key, file.buffer, inspected.contentType);
  } catch (err) {
    logger.error({ err, key }, 'Receipt upload to storage failed');
    throw new HttpError(503, 'STORAGE_UNAVAILABLE', 'File storage is not reachable. Try again in a moment.');
  }
  try {
    const created = await prisma.$transaction(async (tx) => {
      await lockTravel(tx, id);
      await assertCanManageAttachments(actor, id, tx);
      const active = await tx.travelAttachment.count({ where: { travelTaskId: id, status: 'ACTIVE' } });
      if (active >= TRAVEL_MAX_ATTACHMENTS) throw conflict('CONFLICT', travelAttachmentLimitMessage(ttId));
      const row = await tx.travelAttachment.create({
        data: {
          id: attachmentId,
          travelTaskId: id,
          objectKey: key,
          contentType: inspected.contentType,
          sizeBytes: file.size,
          width: inspected.width,
          height: inspected.height,
          originalName: file.originalname.slice(0, 255) || null,
          uploadedById: actor.id,
        },
        include: uploadedBy,
      });
      await tx.travelTaskEvent.create({
        data: {
          travelTaskId: id,
          actorId: actor.id,
          type: 'TT_ATTACHMENT_ADDED',
          data: { ttId, attachmentId, name: row.originalName, contentType: row.contentType },
        },
      });
      return row;
    });
    return await toAttachmentDto(storage, created);
  } catch (err) {
    await storage.delete(key).catch((cleanupErr: unknown) => logger.warn({ err: cleanupErr, key }, 'Could not clean up an orphaned receipt'));
    throw err;
  }
}

/**
 * `POST /travel-tasks/:id/attachments/:aid/remove`: status REMOVED with the actor, time and optional reason. The
 * row and the object stay (as D-100). 404 for another TT's receipt, 409 when it was already removed.
 */
export async function removeAttachment(actor: User, id: string, attachmentId: string, reason: string | null | undefined): Promise<void> {
  await assertCanManageAttachments(actor, id);
  await prisma.$transaction(async (tx) => {
    await lockTravel(tx, id);
    const tt = await assertCanManageAttachments(actor, id, tx);
    const attachment = await tx.travelAttachment.findUnique({ where: { id: attachmentId } });
    if (!attachment || attachment.travelTaskId !== id) throw notFound('Receipt not found');
    if (attachment.status !== 'ACTIVE') throw conflict('CONFLICT', 'This receipt was already removed');
    await tx.travelAttachment.update({
      where: { id: attachmentId },
      data: { status: 'REMOVED', removedById: actor.id, removedAt: new Date(), removeReason: reason ?? null },
    });
    await tx.travelTaskEvent.create({
      data: {
        travelTaskId: id,
        actorId: actor.id,
        type: 'TT_ATTACHMENT_REMOVED',
        data: { ttId: formatTtId(tt.ttNo), attachmentId, name: attachment.originalName, ...(reason && { reason }) },
      },
    });
  });
}
