import { z } from 'zod';

/**
 * In-app notifications (F13, D-228–D-232): what a user is told about, how it is shaped on the wire and the
 * Socket.IO protocol the web and the app listen on.
 */

export const NOTIFICATION_TYPES = [
  'FITMENT_ASSIGNED',
  'FITMENT_UNASSIGNED',
  'FITMENT_SUBMITTED',
  'FITMENT_VERIFIED',
  'FITMENT_APPROVED',
  'FITMENT_REOPENED',
  'FITMENT_MOVED_TO_FT',
  'TRAVEL_RAISED',
  'TRAVEL_VERIFIED',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotificationDto {
  id: string;
  type: NotificationType;
  /** Ready-to-show text, e.g. "TK-00012 submitted by Arjun · ready to verify", "5 fitments of OM-00012 submitted by Arjun". */
  title: string;
  /** Second line (customer · site · time, the reopen reason, the replacement TK…), or null. */
  body: string | null;
  /** Where a tap goes. */
  target: { kind: 'FITMENT'; taskId: string; fitmentId: string | null } | { kind: 'TRAVEL'; travelTaskId: string };
  /** Fitments covered (grouped notifications have several). */
  count: number;
  actor: { id: string; name: string } | null;
  read: boolean;
  /** UTC ISO; the time it was last grouped into when grouped later. */
  createdAt: string;
}

export interface NotificationListResponse {
  items: NotificationDto[];
  unreadCount: number;
  nextCursor: string | null;
}

export const notificationListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** Socket.IO */
export const NOTIFICATION_SOCKET_PATH = '/socket.io';
/** Payload: `{ notification: NotificationDto; unreadCount: number }`. */
export const NOTIFICATION_EVENT = 'notification';
/** Payload: `{ unreadCount: number }` (after read / read-all, for the user's other tabs and devices). */
export const NOTIFICATION_COUNT_EVENT = 'notifications:count';
export const NOTIFICATION_RETENTION_DAYS = 30;
export const NOTIFICATION_GROUP_WINDOW_MS = 2 * 60_000;
