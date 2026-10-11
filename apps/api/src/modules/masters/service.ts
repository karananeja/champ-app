import {
  LOOKUP_KIND_LABELS,
  canEditLookupKind,
  canEditMasters,
  toMakeModelKey,
  toNameKey,
  type ActivityDto,
  type ActivityListQuery,
  type CreateActivityInput,
  type CreateLocationInput,
  type CreateLookupItemInput,
  type CreateMakeModelInput,
  type LocationDto,
  type LocationListQuery,
  type LookupItemDto,
  type LookupKind,
  type MakeModelDto,
  type MasterListQuery,
  type UpdateActivityInput,
  type UpdateLocationInput,
  type UpdateLookupItemInput,
  type UpdateMakeModelInput,
} from '@champ/shared';
import type { Prisma } from '../../generated/prisma/client';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { prisma, type User } from '../../lib/prisma';
import { duplicate, requireActiveLookup, withDuplicateCheck } from './refs';

const contains = (q: string) => ({ contains: q, mode: 'insensitive' as const });
const iso = (d: Date) => d.toISOString();

function assertCanEdit(actor: User, kind?: LookupKind) {
  const allowed = kind ? canEditLookupKind(actor, kind) : canEditMasters(actor);
  if (!allowed) throw forbidden();
}

// --- Lookup items (simple masters) ---

type LookupRow = Prisma.LookupItemGetPayload<object>;

const toLookupDto = (item: LookupRow): LookupItemDto => ({
  id: item.id,
  kind: item.kind,
  name: item.name,
  code: item.code,
  isSystem: item.isSystem,
  active: item.active,
  billable: item.billable,
  sortOrder: item.sortOrder,
  createdAt: iso(item.createdAt),
  updatedAt: iso(item.updatedAt),
});

export const lookupOrder: Prisma.LookupItemOrderByWithRelationInput[] = [{ sortOrder: 'asc' }, { name: 'asc' }];

export async function listLookupItems(kind: LookupKind, query: MasterListQuery): Promise<LookupItemDto[]> {
  const items = await prisma.lookupItem.findMany({
    where: {
      kind,
      ...(query.active !== undefined ? { active: query.active } : {}),
      ...(query.q ? { name: contains(query.q) } : {}),
    },
    orderBy: lookupOrder,
  });
  return items.map(toLookupDto);
}

const duplicateLookupMessage = (kind: LookupKind, name: string) =>
  `"${name}" already exists in ${LOOKUP_KIND_LABELS[kind].plural}`;

async function assertLookupNameFree(kind: LookupKind, name: string, exceptId?: string) {
  const clash = await prisma.lookupItem.findUnique({ where: { kind_nameKey: { kind, nameKey: toNameKey(name) } } });
  if (clash && clash.id !== exceptId) throw duplicate(duplicateLookupMessage(kind, clash.name));
}

const billableRequired = () =>
  badRequest('VALIDATION_ERROR', 'Choose whether this final issue is billable', {
    fieldErrors: { billable: ['Billable is required for a final issue'] },
  });

export async function createLookupItem(
  actor: User,
  kind: LookupKind,
  input: CreateLookupItemInput,
): Promise<LookupItemDto> {
  assertCanEdit(actor, kind);
  if (kind === 'FINAL_ISSUE' && input.billable === undefined) throw billableRequired();
  await assertLookupNameFree(kind, input.name);

  // Unordered kinds (all sortOrder 0) stay alphabetical; in ordered kinds (shift and task types) new items go
  // after the built-ins, e.g. custom task types follow OT, TT, FT.
  const { _max } = await prisma.lookupItem.aggregate({ where: { kind }, _max: { sortOrder: true } });
  const maxOrder = _max.sortOrder ?? 0;
  const item = await withDuplicateCheck(
    () =>
      prisma.lookupItem.create({
        data: {
          kind,
          name: input.name,
          nameKey: toNameKey(input.name),
          billable: kind === 'FINAL_ISSUE' ? input.billable : null,
          sortOrder: maxOrder > 0 ? maxOrder + 1 : 0,
        },
      }),
    duplicateLookupMessage(kind, input.name),
  );
  return toLookupDto(item);
}

export async function updateLookupItem(
  actor: User,
  kind: LookupKind,
  id: string,
  input: UpdateLookupItemInput,
): Promise<LookupItemDto> {
  assertCanEdit(actor, kind);
  const item = await prisma.lookupItem.findUnique({ where: { id } });
  if (!item || item.kind !== kind) throw notFound(`${LOOKUP_KIND_LABELS[kind].singular} not found`);

  const renaming = input.name !== undefined && input.name !== item.name;
  if (item.isSystem && (renaming || input.active === false)) {
    throw conflict('SYSTEM_ITEM', `${item.name} is built in and can't be renamed or deactivated`);
  }
  if (renaming) await assertLookupNameFree(kind, input.name!, item.id);

  const data: Prisma.LookupItemUpdateInput = {};
  if (renaming) {
    data.name = input.name;
    data.nameKey = toNameKey(input.name!);
  }
  if (input.active !== undefined) data.active = input.active;
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
  if (input.billable !== undefined && kind === 'FINAL_ISSUE') data.billable = input.billable;

  const updated = await withDuplicateCheck(
    () => prisma.lookupItem.update({ where: { id }, data }),
    duplicateLookupMessage(kind, input.name ?? item.name),
  );
  return toLookupDto(updated);
}

// --- Activities ---

const activityInclude = { assetType: { select: { id: true, name: true } } } satisfies Prisma.ActivityInclude;
type ActivityRow = Prisma.ActivityGetPayload<{ include: typeof activityInclude }>;

const toActivityDto = (a: ActivityRow): ActivityDto => ({
  id: a.id,
  name: a.name,
  assetTypeId: a.assetTypeId,
  assetType: a.assetType,
  active: a.active,
  createdAt: iso(a.createdAt),
  updatedAt: iso(a.updatedAt),
});

export async function listActivities(query: ActivityListQuery): Promise<ActivityDto[]> {
  const items = await prisma.activity.findMany({
    where: {
      ...(query.assetTypeId ? { assetTypeId: query.assetTypeId } : {}),
      ...(query.active !== undefined ? { active: query.active } : {}),
      ...(query.q ? { name: contains(query.q) } : {}),
    },
    include: activityInclude,
    orderBy: [{ assetType: { sortOrder: 'asc' } }, { assetType: { name: 'asc' } }, { name: 'asc' }],
  });
  return items.map(toActivityDto);
}

async function assertActivityFree(assetTypeId: string, name: string, exceptId?: string) {
  const clash = await prisma.activity.findUnique({
    where: { assetTypeId_nameKey: { assetTypeId, nameKey: toNameKey(name) } },
    include: activityInclude,
  });
  if (clash && clash.id !== exceptId) {
    throw duplicate(`"${clash.name}" already exists for ${clash.assetType.name}`);
  }
}

export async function createActivity(actor: User, input: CreateActivityInput): Promise<ActivityDto> {
  assertCanEdit(actor);
  const assetType = await requireActiveLookup(input.assetTypeId, 'ASSET_TYPE', 'assetTypeId');
  await assertActivityFree(assetType.id, input.name);
  const activity = await withDuplicateCheck(
    () =>
      prisma.activity.create({
        data: { name: input.name, nameKey: toNameKey(input.name), assetTypeId: assetType.id },
        include: activityInclude,
      }),
    `"${input.name}" already exists for ${assetType.name}`,
  );
  return toActivityDto(activity);
}

export async function updateActivity(actor: User, id: string, input: UpdateActivityInput): Promise<ActivityDto> {
  assertCanEdit(actor);
  const activity = await prisma.activity.findUnique({ where: { id } });
  if (!activity) throw notFound('Activity not found');

  const assetTypeChanged = input.assetTypeId !== undefined && input.assetTypeId !== activity.assetTypeId;
  if (assetTypeChanged) await requireActiveLookup(input.assetTypeId!, 'ASSET_TYPE', 'assetTypeId');
  const name = input.name ?? activity.name;
  const assetTypeId = input.assetTypeId ?? activity.assetTypeId;
  if (assetTypeChanged || name !== activity.name) await assertActivityFree(assetTypeId, name, activity.id);

  const updated = await withDuplicateCheck(
    () =>
      prisma.activity.update({
        where: { id },
        data: {
          name,
          nameKey: toNameKey(name),
          assetTypeId,
          ...(input.active !== undefined ? { active: input.active } : {}),
        },
        include: activityInclude,
      }),
    `"${name}" already exists for this asset type`,
  );
  return toActivityDto(updated);
}

// --- Vehicle make/models ---

const toMakeModelDto = (m: Prisma.VehicleMakeModelGetPayload<object>): MakeModelDto => ({
  id: m.id,
  make: m.make,
  model: m.model,
  active: m.active,
  createdAt: iso(m.createdAt),
  updatedAt: iso(m.updatedAt),
});

export async function listMakeModels(query: MasterListQuery): Promise<MakeModelDto[]> {
  const items = await prisma.vehicleMakeModel.findMany({
    where: {
      ...(query.active !== undefined ? { active: query.active } : {}),
      ...(query.q ? { OR: [{ make: contains(query.q) }, { model: contains(query.q) }] } : {}),
    },
    orderBy: [{ make: 'asc' }, { model: 'asc' }],
  });
  return items.map(toMakeModelDto);
}

async function assertMakeModelFree(make: string, model: string, exceptId?: string) {
  const clash = await prisma.vehicleMakeModel.findUnique({ where: { key: toMakeModelKey(make, model) } });
  if (clash && clash.id !== exceptId) throw duplicate(`"${clash.make} ${clash.model}" already exists`);
}

export async function createMakeModel(actor: User, input: CreateMakeModelInput): Promise<MakeModelDto> {
  assertCanEdit(actor);
  await assertMakeModelFree(input.make, input.model);
  const created = await withDuplicateCheck(
    () =>
      prisma.vehicleMakeModel.create({
        data: { make: input.make, model: input.model, key: toMakeModelKey(input.make, input.model) },
      }),
    `"${input.make} ${input.model}" already exists`,
  );
  return toMakeModelDto(created);
}

export async function updateMakeModel(actor: User, id: string, input: UpdateMakeModelInput): Promise<MakeModelDto> {
  assertCanEdit(actor);
  const current = await prisma.vehicleMakeModel.findUnique({ where: { id } });
  if (!current) throw notFound('Make/model not found');
  const make = input.make ?? current.make;
  const model = input.model ?? current.model;
  await assertMakeModelFree(make, model, current.id);
  const updated = await withDuplicateCheck(
    () =>
      prisma.vehicleMakeModel.update({
        where: { id },
        data: {
          make,
          model,
          key: toMakeModelKey(make, model),
          ...(input.active !== undefined ? { active: input.active } : {}),
        },
      }),
    `"${make} ${model}" already exists`,
  );
  return toMakeModelDto(updated);
}

// --- Locations ---

const locationInclude = {
  state: { select: { id: true, name: true } },
  region: { select: { id: true, name: true } },
} satisfies Prisma.LocationInclude;
type LocationRow = Prisma.LocationGetPayload<{ include: typeof locationInclude }>;

const toLocationDto = (l: LocationRow): LocationDto => ({
  id: l.id,
  city: l.city,
  stateId: l.stateId,
  regionId: l.regionId,
  state: l.state,
  region: l.region,
  active: l.active,
  createdAt: iso(l.createdAt),
  updatedAt: iso(l.updatedAt),
});

export async function listLocations(query: LocationListQuery): Promise<LocationDto[]> {
  const items = await prisma.location.findMany({
    where: {
      ...(query.stateId ? { stateId: query.stateId } : {}),
      ...(query.regionId ? { regionId: query.regionId } : {}),
      ...(query.active !== undefined ? { active: query.active } : {}),
      ...(query.q ? { city: contains(query.q) } : {}),
    },
    include: locationInclude,
    orderBy: [{ city: 'asc' }, { state: { name: 'asc' } }],
  });
  return items.map(toLocationDto);
}

async function assertCityFree(stateId: string, city: string, exceptId?: string) {
  const clash = await prisma.location.findUnique({
    where: { stateId_cityKey: { stateId, cityKey: toNameKey(city) } },
    include: locationInclude,
  });
  if (clash && clash.id !== exceptId) throw duplicate(`${clash.city} already exists in ${clash.state.name}`);
}

export async function createLocation(actor: User, input: CreateLocationInput): Promise<LocationDto> {
  assertCanEdit(actor);
  const state = await requireActiveLookup(input.stateId, 'STATE', 'stateId');
  await requireActiveLookup(input.regionId, 'REGION', 'regionId');
  await assertCityFree(state.id, input.city);
  const created = await withDuplicateCheck(
    () =>
      prisma.location.create({
        data: { city: input.city, cityKey: toNameKey(input.city), stateId: input.stateId, regionId: input.regionId },
        include: locationInclude,
      }),
    `${input.city} already exists in ${state.name}`,
  );
  return toLocationDto(created);
}

export async function updateLocation(actor: User, id: string, input: UpdateLocationInput): Promise<LocationDto> {
  assertCanEdit(actor);
  const current = await prisma.location.findUnique({ where: { id } });
  if (!current) throw notFound('Location not found');

  const stateChanged = input.stateId !== undefined && input.stateId !== current.stateId;
  if (stateChanged) await requireActiveLookup(input.stateId!, 'STATE', 'stateId');
  if (input.regionId !== undefined && input.regionId !== current.regionId) {
    await requireActiveLookup(input.regionId, 'REGION', 'regionId');
  }
  const city = input.city ?? current.city;
  const stateId = input.stateId ?? current.stateId;
  if (stateChanged || city !== current.city) await assertCityFree(stateId, city, current.id);

  const updated = await withDuplicateCheck(
    () =>
      prisma.location.update({
        where: { id },
        data: {
          city,
          cityKey: toNameKey(city),
          stateId,
          regionId: input.regionId ?? current.regionId,
          ...(input.active !== undefined ? { active: input.active } : {}),
        },
        include: locationInclude,
      }),
    `${city} already exists in this state`,
  );
  return toLocationDto(updated);
}
