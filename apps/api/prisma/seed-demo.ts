/**
 * Optional demo data (`pnpm db:seed:demo`): a demo OM, a demo OE and three sample technicians (OT) with
 * type and base location. Run after `pnpm db:seed`. Idempotent: existing emails are skipped.
 * All demo accounts use the password `Demo@1234`.
 */
import type { TechnicianType } from '@champ/shared';
import { hashPassword } from '../src/lib/password';
import { logger } from '../src/lib/logger';
import { prisma } from '../src/lib/prisma';

const DEMO_PASSWORD = 'Demo@1234';

const TECHNICIANS: { email: string; name: string; phone: string; type: TechnicianType; city: string }[] = [
  { email: 'ravi.ot@intellicar.in', name: 'Ravi Kumar', phone: '+91 90000 00001', type: 'PAYROLL', city: 'Bengaluru' },
  { email: 'suresh.ot@intellicar.in', name: 'Suresh Patil', phone: '+91 90000 00002', type: 'THIRD_PARTY', city: 'Pune' },
  { email: 'amit.ot@intellicar.in', name: 'Amit Singh', phone: '+91 90000 00003', type: 'CONTRACTUAL', city: 'New Delhi' },
];

async function main() {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const ensure = async (email: string, create: () => Promise<{ id: string }>) => {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      logger.info(`Demo seed: ${email} already exists, skipping`);
      return existing;
    }
    const user = await create();
    logger.info(`Demo seed: created ${email}`);
    return user;
  };

  const om = await ensure('demo.om@intellicar.in', () =>
    prisma.user.create({
      data: { email: 'demo.om@intellicar.in', name: 'Meera (Demo OM)', role: 'OM', passwordHash },
    }),
  );
  const oe = await ensure('demo.oe@intellicar.in', () =>
    prisma.user.create({
      data: { email: 'demo.oe@intellicar.in', name: 'Esha (Demo OE)', role: 'OE', managerId: om.id, passwordHash },
    }),
  );

  for (const tech of TECHNICIANS) {
    const location = await prisma.location.findFirst({ where: { city: tech.city, active: true } });
    if (!location) throw new Error(`Demo seed: location ${tech.city} not found. Run \`pnpm db:seed\` first.`);
    await ensure(tech.email, () =>
      prisma.user.create({
        data: {
          email: tech.email,
          name: tech.name,
          phone: tech.phone,
          role: 'OT',
          managerId: oe.id,
          technicianType: tech.type,
          baseLocationId: location.id,
          passwordHash,
        },
      }),
    );
  }
  logger.info(`Demo seed: done. Demo accounts use the password ${DEMO_PASSWORD}`);
}

main()
  .catch((err: unknown) => {
    logger.error({ err }, 'Demo seed failed');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
