import { createApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { defaultStorage } from './lib/storage';
import { startNotificationHub, type NotificationHub } from './modules/notifications/hub';
import { startNotificationRetention } from './modules/notifications/retention';

// F06 (D-102): make sure the private photo bucket exists. A storage outage doesn't stop the API; photo
// requests then fail with 503 STORAGE_UNAVAILABLE until it is back.
const storage = defaultStorage();
try {
  await storage.ensureBucket?.();
  if (storage.ensureBucket) logger.info(`Photo storage ready (bucket "${env.S3_BUCKET}")`);
} catch (err) {
  logger.error({ err }, `Photo storage is not reachable (bucket "${env.S3_BUCKET}"); photos will fail until it is`);
}

const server = createApp({ storage }).listen(env.API_PORT, () => {
  logger.info(`Champ API listening on http://localhost:${env.API_PORT}`);
});

// F13 (D-230, D-231): live notifications over Socket.IO, and the 30-day retention. The API still serves the bell
// over REST when the database listener can't start.
let hub: NotificationHub | null = null;
try {
  hub = await startNotificationHub(server);
} catch (err) {
  logger.error({ err }, 'Live notifications are unavailable');
}
const stopRetention = startNotificationRetention();

function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  stopRetention();
  const closed = () => void prisma.$disconnect().finally(() => process.exit(0));
  if (hub) void hub.stop().finally(closed);
  else server.close(closed);
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
