import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';

export async function checkDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (err) {
    logger.warn({ err }, 'Database health check failed');
    return false;
  }
}
