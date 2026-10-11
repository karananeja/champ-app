/**
 * Optional demo data (`pnpm db:seed:demo`): a demo OM, a demo OE, three sample technicians (OT) with
 * type and base location, and two sample clients with sites (F03; hard-coded coordinates, no geocoding).
 * Run after `pnpm db:seed`. Idempotent: existing emails and client names are skipped.
 * All demo accounts use the password `Demo@1234`.
 */
import { toNameKey, type TechnicianType } from '@champ/shared';
import { hashPassword } from '../src/lib/password';
import { logger } from '../src/lib/logger';
import { prisma } from '../src/lib/prisma';

const DEMO_PASSWORD = 'Demo@1234';

const TECHNICIANS: { email: string; name: string; phone: string; type: TechnicianType; city: string }[] = [
  { email: 'ravi.ot@intellicar.in', name: 'Ravi Kumar', phone: '+91 90000 00001', type: 'PAYROLL', city: 'Bengaluru' },
  { email: 'suresh.ot@intellicar.in', name: 'Suresh Patil', phone: '+91 90000 00002', type: 'THIRD_PARTY', city: 'Pune' },
  { email: 'amit.ot@intellicar.in', name: 'Amit Singh', phone: '+91 90000 00003', type: 'CONTRACTUAL', city: 'New Delhi' },
];

interface DemoSite {
  name: string;
  address: string;
  lat: number;
  lng: number;
  city: string;
  contactName?: string;
  contactPhone?: string;
}

const CLIENTS: {
  name: string;
  code: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  billingEmail: string;
  sites: DemoSite[];
}[] = [
  {
    name: 'Demo Fleet Rentals',
    code: 'DFR',
    contactName: 'Priya Rao',
    contactPhone: '+91 90000 10001',
    contactEmail: 'priya@demo-fleet.example',
    billingEmail: 'accounts@demo-fleet.example',
    sites: [
      {
        name: 'Bengaluru depot',
        address: 'Hosur Road, Electronic City, Bengaluru, Karnataka 560100',
        lat: 12.8452,
        lng: 77.6602,
        city: 'Bengaluru',
        contactName: 'Manoj',
        contactPhone: '+91 90000 10002',
      },
      {
        name: 'Pune yard',
        address: 'Hinjewadi Phase 1, Pune, Maharashtra 411057',
        lat: 18.5912,
        lng: 73.7389,
        city: 'Pune',
      },
    ],
  },
  {
    name: 'Demo Logistics',
    code: 'DLOG',
    contactName: 'Arvind Mehta',
    contactPhone: '+91 90000 20001',
    contactEmail: 'arvind@demo-logistics.example',
    billingEmail: 'billing@demo-logistics.example',
    sites: [
      {
        name: 'Delhi hub',
        address: 'Okhla Industrial Area Phase 2, New Delhi, Delhi 110020',
        lat: 28.5355,
        lng: 77.2732,
        city: 'New Delhi',
      },
    ],
  },
];

async function seedClients(createdById: string) {
  for (const client of CLIENTS) {
    const nameKey = toNameKey(client.name);
    if (await prisma.client.findUnique({ where: { nameKey } })) {
      logger.info(`Demo seed: client ${client.name} already exists, skipping`);
      continue;
    }
    const sites = [];
    for (const site of client.sites) {
      const location = await prisma.location.findFirst({ where: { city: site.city, active: true } });
      if (!location) throw new Error(`Demo seed: location ${site.city} not found. Run \`pnpm db:seed\` first.`);
      const { city: _city, ...rest } = site;
      sites.push({ ...rest, nameKey: toNameKey(site.name), locationId: location.id });
    }
    const { sites: _sites, ...fields } = client;
    await prisma.client.create({ data: { ...fields, nameKey, createdById, sites: { create: sites } } });
    logger.info(`Demo seed: created client ${client.name} (${sites.length} sites)`);
  }
}

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
  await seedClients(om.id);
  logger.info(`Demo seed: done. Demo accounts use the password ${DEMO_PASSWORD}`);
}

main()
  .catch((err: unknown) => {
    logger.error({ err }, 'Demo seed failed');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
