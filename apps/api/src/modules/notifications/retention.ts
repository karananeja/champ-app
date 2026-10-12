import { logger } from '../../lib/logger';
import { deleteExpiredNotifications } from './service';

const EVERY_MS = 6 * 60 * 60_000;

/** Retention (D-231): deletes expired notifications on startup and every 6 hours. Returns a stop function. */
export function startNotificationRetention(): () => void {
  const run = () =>
    deleteExpiredNotifications()
      .then((count) => count > 0 && logger.info(`Deleted ${count} expired notifications`))
      .catch((err: unknown) => logger.error({ err }, 'Notification retention failed'));
  void run();
  const timer = setInterval(() => void run(), EVERY_MS);
  timer.unref();
  return () => clearInterval(timer);
}
