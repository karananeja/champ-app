import type { Server as HttpServer } from 'node:http';
import pg from 'pg';
import { Server } from 'socket.io';
import { NOTIFICATION_COUNT_EVENT, NOTIFICATION_EVENT, NOTIFICATION_SOCKET_PATH } from '@champ/shared';
import { env } from '../../config/env';
import { verifyAccessToken } from '../../lib/jwt';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import { NOTIFICATION_CHANNEL, type NotifyPayload } from './notifier';
import { getNotificationDto, unreadCount } from './service';

const RECONNECT_MS = 5_000;
const room = (userId: string) => `user:${userId}`;

export interface NotificationHub {
  io: Server;
  stop(): Promise<void>;
}

/**
 * Live delivery (F13, D-230): Socket.IO on the API's HTTP server plus one dedicated `pg` client that LISTENs on
 * NOTIFICATION_CHANNEL. Committed notifications are loaded and emitted to the room `user:<id>`. Started only by
 * `server.ts` (and one integration test), never by `createApp`.
 */
export async function startNotificationHub(httpServer: HttpServer): Promise<NotificationHub> {
  const io = new Server(httpServer, {
    path: NOTIFICATION_SOCKET_PATH,
    cors: { origin: env.WEB_URL, credentials: true },
  });

  // Same token and checks as `authenticate`: a valid access token of an active user. The client refreshes on UNAUTHORIZED.
  io.use((socket, next) => {
    const token: unknown = socket.handshake.auth?.token;
    const payload = typeof token === 'string' ? verifyAccessToken(token) : null;
    if (!payload) return next(new Error('UNAUTHORIZED'));
    prisma.user
      .findUnique({ where: { id: payload.sub }, select: { status: true } })
      .then((user) => {
        if (user?.status !== 'ACTIVE') return next(new Error('UNAUTHORIZED'));
        socket.data.userId = payload.sub;
        next();
      })
      .catch(() => next(new Error('UNAUTHORIZED')));
  });
  io.on('connection', (socket) => {
    void socket.join(room(socket.data.userId as string));
  });

  async function deliver(raw: string) {
    const msg = JSON.parse(raw) as NotifyPayload;
    if ('unreadCount' in msg) {
      io.to(room(msg.userId)).emit(NOTIFICATION_COUNT_EVENT, { unreadCount: msg.unreadCount });
      return;
    }
    const found = await getNotificationDto(msg.notificationId);
    if (!found) return;
    io.to(room(found.userId)).emit(NOTIFICATION_EVENT, { notification: found.dto, unreadCount: await unreadCount(found.userId) });
  }

  let stopped = false;
  let client: pg.Client | null = null;
  let retry: NodeJS.Timeout | null = null;
  async function listen() {
    const c = new pg.Client({ connectionString: env.DATABASE_URL });
    c.on('notification', (n) => {
      if (n.channel !== NOTIFICATION_CHANNEL || !n.payload) return;
      deliver(n.payload).catch((err: unknown) => logger.error({ err }, 'Notification delivery failed'));
    });
    // A lost connection is re-established; notifications committed meanwhile wait in the bell (REST).
    c.on('error', (err) => {
      logger.error({ err }, 'Notification listener lost its database connection');
      void c.end().catch(() => undefined);
      if (client === c) client = null;
      if (!stopped) retry = setTimeout(() => void listen().catch(() => undefined), RECONNECT_MS);
    });
    await c.connect();
    await c.query(`LISTEN ${NOTIFICATION_CHANNEL}`);
    client = c;
  }
  await listen();

  return {
    io,
    async stop() {
      stopped = true;
      if (retry) clearTimeout(retry);
      await client?.end().catch(() => undefined);
      // Also closes the HTTP server (Socket.IO owns it from here); open sockets would otherwise keep it alive.
      await new Promise<void>((resolve) => void io.close(() => resolve()));
    },
  };
}
