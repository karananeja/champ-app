import {
  NOTIFICATION_RETENTION_DAYS,
  type NotificationDto,
  type NotificationListResponse,
  type NotificationType,
  type notificationListQuerySchema,
} from '@champ/shared';
import type { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import { badRequest, notFound } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { pgNotify } from './notifier';

const dtoSelect = {
  id: true,
  type: true,
  title: true,
  body: true,
  taskId: true,
  fitmentIds: true,
  travelTaskId: true,
  count: true,
  readAt: true,
  updatedAt: true,
  actor: { select: { id: true, name: true } },
} satisfies Prisma.NotificationSelect;

type Row = Prisma.NotificationGetPayload<{ select: typeof dtoSelect }>;

/** The technician of each single-fitment notification's fitment, to tell technician recipients from OE/OM ones. */
async function techniciansOf(rows: readonly Row[]): Promise<Map<string, string | null>> {
  const ids = rows.filter((n) => n.fitmentIds.length === 1).map((n) => n.fitmentIds[0]!);
  if (ids.length === 0) return new Map();
  const fitments = await prisma.fitment.findMany({ where: { id: { in: ids } }, select: { id: true, technicianId: true } });
  return new Map(fitments.map((f) => [f.id, f.technicianId]));
}

export function toNotificationDto(n: Row & { userId: string }, technicianOf: Map<string, string | null>): NotificationDto {
  const fitmentId = n.fitmentIds.length === 1 ? (n.fitmentIds[0] ?? null) : null;
  return {
    id: n.id,
    type: n.type as NotificationType,
    title: n.title,
    body: n.body,
    // A grouped notification opens its latest fitment's task; the web/app pick the fitment only when there is one.
    target: n.travelTaskId
      ? { kind: 'TRAVEL', travelTaskId: n.travelTaskId }
      : { kind: 'FITMENT', taskId: n.taskId ?? '', fitmentId },
    forTechnician: fitmentId !== null && technicianOf.get(fitmentId) === n.userId,
    count: n.count,
    actor: n.actor,
    read: n.readAt !== null,
    createdAt: n.updatedAt.toISOString(),
  };
}

type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

export const unreadCount = (userId: string) => prisma.notification.count({ where: { userId, readAt: null } });

export async function getNotificationDto(id: string): Promise<{ userId: string; dto: NotificationDto } | null> {
  const row = await prisma.notification.findUnique({ where: { id }, select: { ...dtoSelect, userId: true } });
  return row ? { userId: row.userId, dto: toNotificationDto(row, await techniciansOf([row])) } : null;
}

const encodeCursor = (n: { updatedAt: Date; id: string }) => Buffer.from(`${n.updatedAt.toISOString()}|${n.id}`).toString('base64url');

function decodeCursor(cursor: string): { updatedAt: Date; id: string } {
  const [at, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const updatedAt = new Date(at ?? '');
  if (!id || Number.isNaN(updatedAt.getTime())) throw badRequest('VALIDATION_ERROR', 'Invalid cursor');
  return { updatedAt, id };
}

/** `GET /notifications`: own notifications, newest (last grouped) first, keyset-paginated. */
export async function listNotifications(userId: string, query: NotificationListQuery): Promise<NotificationListResponse> {
  const after = query.cursor ? decodeCursor(query.cursor) : null;
  const where: Prisma.NotificationWhereInput = {
    userId,
    ...(after && { OR: [{ updatedAt: { lt: after.updatedAt } }, { updatedAt: after.updatedAt, id: { lt: after.id } }] }),
  };
  const [rows, count] = await Promise.all([
    prisma.notification.findMany({ where, select: { ...dtoSelect, userId: true }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: query.limit + 1 }),
    unreadCount(userId),
  ]);
  const page = rows.slice(0, query.limit);
  const technicianOf = await techniciansOf(page);
  return {
    items: page.map((n) => toNotificationDto(n, technicianOf)),
    unreadCount: count,
    nextCursor: rows.length > query.limit ? encodeCursor(page[page.length - 1]!) : null,
  };
}

/** Marks one own notification read (404 for anyone else's) and tells the user's other tabs and devices. */
export async function markRead(userId: string, id: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const found = await tx.notification.findFirst({ where: { id, userId }, select: { readAt: true } });
    if (!found) throw notFound('Notification not found');
    if (found.readAt) return;
    // Raw SQL: reading must not bump updatedAt (the list order and the retention clock).
    await tx.$executeRaw`UPDATE "Notification" SET "readAt" = now() WHERE "id" = ${id}`;
    await pgNotify(tx, { userId, unreadCount: await tx.notification.count({ where: { userId, readAt: null } }) });
  });
}

export async function markAllRead(userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const count = await tx.$executeRaw`UPDATE "Notification" SET "readAt" = now() WHERE "userId" = ${userId} AND "readAt" IS NULL`;
    if (count > 0) await pgNotify(tx, { userId, unreadCount: 0 });
  });
}

/** Retention (D-231): deletes notifications last updated more than NOTIFICATION_RETENTION_DAYS ago. */
export async function deleteExpiredNotifications(now: Date = new Date()): Promise<number> {
  const before = new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60_000);
  const { count } = await prisma.notification.deleteMany({ where: { updatedAt: { lt: before } } });
  return count;
}
