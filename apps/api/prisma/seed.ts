/**
 * Base seed: the first Super Admin, the master data (F02) and the task id counters (F04). Idempotent: an
 * existing Super Admin is left untouched, master values are upserted (see seed-masters.ts) and existing
 * counters keep their values.
 */
import { passwordSchema } from '@champ/shared';
import { ensureCounters } from '../src/lib/counters';
import { hashPassword } from '../src/lib/password';
import { logger } from '../src/lib/logger';
import { prisma } from '../src/lib/prisma';
import { seedMasters } from './seed-masters';

async function seedSuperAdmin() {
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

async function main() {
  await seedSuperAdmin();
  await seedMasters(prisma);
  await ensureCounters(prisma);
  const [lookups, activities, makeModels, locations] = await Promise.all([
    prisma.lookupItem.count(),
    prisma.activity.count(),
    prisma.vehicleMakeModel.count(),
    prisma.location.count(),
  ]);
  logger.info(
    `Seed: master data ready (${lookups} lookup values, ${activities} activities, ${makeModels} make/models, ${locations} locations)`,
  );
}

main()
  .catch((err: unknown) => {
    logger.error({ err }, 'Seed failed');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
