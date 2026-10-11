/**
 * Seeds the first Super Admin. Idempotent: an existing user with the same email is left untouched.
 */
import { passwordSchema } from '@champ/shared';
import { hashPassword } from '../src/lib/password';
import { logger } from '../src/lib/logger';
import { prisma } from '../src/lib/prisma';

async function main() {
  const email = (process.env.SEED_SUPERADMIN_EMAIL || 'admin@intellicar.in').trim().toLowerCase();
  const password = process.env.SEED_SUPERADMIN_PASSWORD || 'Admin@1234';
  passwordSchema.parse(password);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    logger.info(`Seed: Super Admin ${email} already exists, skipping`);
    return;
  }
  await prisma.user.create({
    data: {
      email,
      name: 'Super Admin',
      role: 'SUPER_ADMIN',
      passwordHash: await hashPassword(password),
      authProvider: 'PASSWORD',
    },
  });
  logger.info(`Seed: created Super Admin ${email}`);
}

main()
  .catch((err: unknown) => {
    logger.error({ err }, 'Seed failed');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
