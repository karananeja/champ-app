import {
  TECHNICIAN_TYPES,
  TECHNICIAN_TYPE_LABELS,
  type LookupKind,
  type LookupOption,
  type LookupsResponse,
} from '@champ/shared';
import { prisma } from '../../lib/prisma';
import { lookupOrder } from './service';

/** All active master values in one response; every dropdown in the app reads from here. */
export async function getLookups(): Promise<LookupsResponse> {
  const [items, activities, makeModels, locations, clients] = await Promise.all([
    prisma.lookupItem.findMany({ where: { active: true }, orderBy: lookupOrder }),
    prisma.activity.findMany({
      where: { active: true, assetType: { active: true } },
      orderBy: { name: 'asc' },
    }),
    prisma.vehicleMakeModel.findMany({ where: { active: true }, orderBy: [{ make: 'asc' }, { model: 'asc' }] }),
    prisma.location.findMany({
      where: { active: true },
      include: { state: { select: { name: true } }, region: { select: { name: true } } },
      orderBy: { city: 'asc' },
    }),
    prisma.client.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        code: true,
        contactName: true,
        contactPhone: true,
        contactEmail: true,
        sites: {
          where: { active: true },
          select: { id: true, name: true, locationId: true, lat: true, lng: true },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    }),
  ]);

  const of = (kind: LookupKind): LookupOption[] =>
    items.filter((i) => i.kind === kind).map(({ id, name, code }) => ({ id, name, code }));

  return {
    assetTypes: of('ASSET_TYPE'),
    activities: activities.map(({ id, name, assetTypeId }) => ({ id, name, code: null, assetTypeId })),
    deviceTypes: of('DEVICE_TYPE'),
    makeModels: makeModels.map(({ id, make, model }) => ({ id, make, model })),
    installationTypes: of('INSTALLATION_TYPE'),
    states: of('STATE'),
    regions: of('REGION'),
    locations: locations.map((l) => ({
      id: l.id,
      city: l.city,
      stateId: l.stateId,
      stateName: l.state.name,
      regionId: l.regionId,
      regionName: l.region.name,
    })),
    issuesReported: of('ISSUE_REPORTED'),
    issuesObserved: of('ISSUE_OBSERVED'),
    actionsTaken: of('ACTION_TAKEN'),
    finalIssues: items
      .filter((i) => i.kind === 'FINAL_ISSUE')
      .map(({ id, name, code, billable }) => ({ id, name, code, billable: billable ?? false })),
    accessories: of('ACCESSORY'),
    closeReasons: of('CLOSE_REASON'),
    shiftTypes: of('SHIFT_TYPE'),
    taskTypes: of('TASK_TYPE'),
    technicianTypes: TECHNICIAN_TYPES.map((value) => ({ value, label: TECHNICIAN_TYPE_LABELS[value] })),
    clients,
  };
}
