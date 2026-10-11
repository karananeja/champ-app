/**
 * Optional demo data (`pnpm db:seed:demo`): a demo OM, a demo OE, three sample technicians (OT) with
 * type and base location, two sample clients with sites (F03; hard-coded coordinates, no geocoding) and
 * three sample tasks (F04: one Open, one Assigned, one split between two technicians).
 * Run after `pnpm db:seed`. Idempotent: existing emails and client names are skipped, and the tasks are
 * skipped when tasks marked `[demo]` in their comments already exist.
 * All demo accounts use the password `Demo@1234`.
 */
import { formatIstDateTime, parseIstDateTime, toNameKey, type CreateTaskInput, type TechnicianType } from '@champ/shared';
import { hashPassword } from '../src/lib/password';
import { logger } from '../src/lib/logger';
import { prisma, type User } from '../src/lib/prisma';
import { assignFitments, createTask } from '../src/modules/tasks/service';

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

const DEMO_MARK = '[demo]';

/** An IST date-time `days` from today at `hour`:00, as ISO. */
function demoTime(days: number, hour: number): string {
  const day = formatIstDateTime(new Date(Date.now() + days * 86_400_000)).slice(0, 10);
  return parseIstDateTime(`${day} ${String(hour).padStart(2, '0')}:00`)!.toISOString();
}

async function seedTasks(om: User, oe: User) {
  if (await prisma.task.count({ where: { comments: { contains: DEMO_MARK } } })) {
    logger.info('Demo seed: demo tasks already exist, skipping');
    return;
  }
  const lookup = async (kind: 'ASSET_TYPE' | 'DEVICE_TYPE' | 'INSTALLATION_TYPE' | 'SHIFT_TYPE' | 'ISSUE_REPORTED', key: string) => {
    const item =
      (await prisma.lookupItem.findFirst({ where: { kind, code: key, active: true } })) ??
      (await prisma.lookupItem.findFirst({ where: { kind, nameKey: toNameKey(key), active: true } }));
    if (!item) throw new Error(`Demo seed: ${kind} ${key} not found. Run \`pnpm db:seed\` first.`);
    return item.id;
  };
  const vehicle = await lookup('ASSET_TYPE', 'VEHICLE');
  const battery = await lookup('ASSET_TYPE', 'BATTERY');
  const activity = async (assetTypeId: string, name: string) =>
    (await prisma.activity.findFirstOrThrow({ where: { assetTypeId, nameKey: toNameKey(name) } })).id;
  const site = async (client: string, name: string) => {
    const row = await prisma.clientSite.findFirstOrThrow({
      where: { nameKey: toNameKey(name), client: { nameKey: toNameKey(client) } },
      include: { client: true },
    });
    return { clientId: row.clientId, siteId: row.id, pocName: row.client.contactName, pocPhone: row.client.contactPhone };
  };
  const tech = (email: string) => prisma.user.findUniqueOrThrow({ where: { email } });
  const [ravi, suresh] = [await tech('ravi.ot@intellicar.in'), await tech('suresh.ot@intellicar.in')];
  const tataAce = await prisma.vehicleMakeModel.findFirstOrThrow({ where: { key: 'tata|ace' } });

  const common = {
    oeId: oe.id,
    deviceTypeId: await lookup('DEVICE_TYPE', 'LAF5'),
    installationTypeId: await lookup('INSTALLATION_TYPE', 'GPS'),
    issueReportedId: await lookup('ISSUE_REPORTED', 'Device not reporting'),
    pocEmail: null,
    gpsAddress: null,
  };
  const tasks: (CreateTaskInput & { split?: true })[] = [
    {
      ...common,
      ...(await site('Demo Fleet Rentals', 'Bengaluru depot')),
      technicianType: null,
      assetTypeId: vehicle,
      activityId: await activity(vehicle, 'New installation'),
      makeModelId: tataAce.id,
      requestedAt: demoTime(1, 10),
      fitmentAt: demoTime(2, 10),
      shiftTypeId: await lookup('SHIFT_TYPE', 'DAY'),
      vehicles: { entry: 'COUNT', count: 3 },
      technicianId: null,
      comments: `${DEMO_MARK} Open task: assign the fitments from the task page`,
    },
    {
      ...common,
      ...(await site('Demo Logistics', 'Delhi hub')),
      technicianType: null,
      assetTypeId: battery,
      activityId: await activity(battery, 'New installation'),
      makeModelId: null,
      requestedAt: demoTime(1, 9),
      fitmentAt: demoTime(3, 21),
      shiftTypeId: await lookup('SHIFT_TYPE', 'NIGHT'),
      vehicles: { entry: 'COUNT', count: 2 },
      technicianId: ravi.id,
      comments: `${DEMO_MARK} Assigned to one technician`,
    },
    {
      ...common,
      ...(await site('Demo Fleet Rentals', 'Pune yard')),
      technicianType: null,
      assetTypeId: vehicle,
      activityId: await activity(vehicle, 'Device replacement'),
      makeModelId: tataAce.id,
      requestedAt: demoTime(2, 8),
      fitmentAt: demoTime(4, 7),
      shiftTypeId: await lookup('SHIFT_TYPE', 'EARLY_MORNING'),
      vehicles: {
        entry: 'CSV',
        rows: [
          { vehicleRegNo: 'MH12AB1001', chassisNo: 'CHS1001' },
          { vehicleRegNo: 'MH12AB1002', chassisNo: 'CHS1002' },
          { vehicleRegNo: 'MH12AB1003', chassisNo: 'CHS1003', oldDeviceId: 'LAF5-OLD-77' },
        ],
      },
      technicianId: null,
      comments: `${DEMO_MARK} Split between two technicians`,
      split: true,
    },
  ];
  for (const { split, ...input } of tasks) {
    const task = await createTask(om, input);
    if (split) {
      const [first, ...rest] = task.fitments;
      await assignFitments(om, task.id, { fitmentIds: [first!.id], technicianId: ravi.id });
      await assignFitments(om, task.id, { fitmentIds: rest.map((f) => f.id), technicianId: suresh.id });
    }
    logger.info(`Demo seed: created task ${task.omId} (${task.fitments.length} fitments)`);
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
  await seedTasks(
    await prisma.user.findUniqueOrThrow({ where: { id: om.id } }),
    await prisma.user.findUniqueOrThrow({ where: { id: oe.id } }),
  );
  logger.info(`Demo seed: done. Demo accounts use the password ${DEMO_PASSWORD}`);
}

main()
  .catch((err: unknown) => {
    logger.error({ err }, 'Demo seed failed');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
