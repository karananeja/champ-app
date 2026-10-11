import {
  canEditClients,
  toNameKey,
  type ClientDto,
  type ClientListItemDto,
  type ClientSiteDto,
  type CreateClientInput,
  type CreateSiteInput,
  type ListClientsQuery,
  type Paginated,
  type UpdateClientInput,
  type UpdateSiteInput,
} from '@champ/shared';
import type { Prisma } from '../../generated/prisma/client';
import { HttpError, conflict, forbidden, notFound } from '../../lib/errors';
import { prisma, type User } from '../../lib/prisma';
import { requireActiveLocation, withDuplicateCheck } from '../masters/refs';

const iso = (d: Date) => d.toISOString();
const contains = (q: string) => ({ contains: q, mode: 'insensitive' as const });

function assertCanEdit(actor: User) {
  if (!canEditClients(actor)) throw forbidden();
}

/** 409 DUPLICATE with the message also attached to the offending form field. */
const duplicateField = (field: string, message: string) =>
  new HttpError(409, 'DUPLICATE', message, { fieldErrors: { [field]: [message] } });

// --- Mapping ---

const siteInclude = {
  location: { select: { id: true, city: true, active: true, state: { select: { name: true } } } },
} satisfies Prisma.ClientSiteInclude;
type SiteRow = Prisma.ClientSiteGetPayload<{ include: typeof siteInclude }>;

function toSiteDto(site: SiteRow): ClientSiteDto {
  return {
    id: site.id,
    clientId: site.clientId,
    name: site.name,
    address: site.address,
    lat: site.lat,
    lng: site.lng,
    locationId: site.locationId,
    location: {
      id: site.location.id,
      city: site.location.city,
      state: site.location.state.name,
      active: site.location.active,
    },
    contactName: site.contactName,
    contactPhone: site.contactPhone,
    active: site.active,
    createdAt: iso(site.createdAt),
    updatedAt: iso(site.updatedAt),
  };
}

type ClientRow = Prisma.ClientGetPayload<object>;

function toListItem(client: ClientRow, sites: { active: boolean }[]): ClientListItemDto {
  return {
    id: client.id,
    name: client.name,
    code: client.code,
    contactName: client.contactName,
    contactPhone: client.contactPhone,
    contactEmail: client.contactEmail,
    billingEmail: client.billingEmail,
    active: client.active,
    siteCount: sites.length,
    activeSiteCount: sites.filter((s) => s.active).length,
    createdAt: iso(client.createdAt),
    updatedAt: iso(client.updatedAt),
  };
}

const clientInclude = {
  createdBy: { select: { id: true, name: true } },
  sites: { include: siteInclude, orderBy: [{ name: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.ClientInclude;
type ClientDetailRow = Prisma.ClientGetPayload<{ include: typeof clientInclude }>;

function toClientDto(client: ClientDetailRow): ClientDto {
  return {
    ...toListItem(client, client.sites),
    notes: client.notes,
    createdBy: client.createdBy,
    sites: client.sites.map(toSiteDto),
  };
}

// --- Duplicate checks ---

const duplicateNameMessage = (name: string) => `A client named "${name}" already exists`;
const duplicateCodeMessage = (code: string, owner: string) => `Code ${code} is already used by ${owner}`;
const duplicateSiteMessage = (name: string) => `"${name}" already exists for this client`;

async function assertClientFree(name: string | undefined, code: string | null | undefined, exceptId?: string) {
  if (name !== undefined) {
    const clash = await prisma.client.findUnique({ where: { nameKey: toNameKey(name) } });
    if (clash && clash.id !== exceptId) throw duplicateField('name', duplicateNameMessage(clash.name));
  }
  if (code) {
    const clash = await prisma.client.findUnique({ where: { code } });
    if (clash && clash.id !== exceptId) throw duplicateField('code', duplicateCodeMessage(code, clash.name));
  }
}

async function assertSiteFree(clientId: string, name: string, field: string, exceptId?: string) {
  const clash = await prisma.clientSite.findUnique({
    where: { clientId_nameKey: { clientId, nameKey: toNameKey(name) } },
  });
  if (clash && clash.id !== exceptId) throw duplicateField(field, duplicateSiteMessage(clash.name));
}

const siteData = (site: CreateSiteInput) => ({
  name: site.name,
  nameKey: toNameKey(site.name),
  address: site.address,
  lat: site.lat,
  lng: site.lng,
  locationId: site.locationId,
  contactName: site.contactName ?? null,
  contactPhone: site.contactPhone ?? null,
});

// --- Clients ---

export async function listClients(query: ListClientsQuery): Promise<Paginated<ClientListItemDto>> {
  const where: Prisma.ClientWhereInput = {
    ...(query.active !== undefined ? { active: query.active } : {}),
    ...(query.q
      ? {
          OR: [
            { name: contains(query.q) },
            { code: contains(query.q) },
            { contactName: contains(query.q) },
            { contactPhone: { contains: query.q } },
            { contactEmail: contains(query.q) },
          ],
        }
      : {}),
  };
  const [total, clients] = await prisma.$transaction([
    prisma.client.count({ where }),
    prisma.client.findMany({
      where,
      include: { sites: { select: { active: true } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return {
    items: clients.map((c) => toListItem(c, c.sites)),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function getClient(id: string): Promise<ClientDto> {
  const client = await prisma.client.findUnique({ where: { id }, include: clientInclude });
  if (!client) throw notFound('Client not found');
  return toClientDto(client);
}

/** Creates the client and its sites in one transaction. */
export async function createClient(actor: User, input: CreateClientInput): Promise<ClientDto> {
  assertCanEdit(actor);
  await assertClientFree(input.name, input.code);

  const seen = new Map<string, string>();
  for (const [i, site] of input.sites.entries()) {
    const key = toNameKey(site.name);
    if (seen.has(key)) throw duplicateField(`sites.${i}.name`, duplicateSiteMessage(seen.get(key)!));
    seen.set(key, site.name);
  }
  for (const [i, site] of input.sites.entries()) {
    await requireActiveLocation(site.locationId, `sites.${i}.locationId`);
  }

  const created = await withDuplicateCheck(
    () =>
      prisma.client.create({
        data: {
          name: input.name,
          nameKey: toNameKey(input.name),
          code: input.code ?? null,
          contactName: input.contactName,
          contactPhone: input.contactPhone,
          contactEmail: input.contactEmail ?? null,
          billingEmail: input.billingEmail ?? null,
          notes: input.notes ?? null,
          createdById: actor.id,
          sites: { create: input.sites.map(siteData) },
        },
        include: clientInclude,
      }),
    `A client with this name or code already exists`,
  );
  return toClientDto(created);
}

export async function updateClient(actor: User, id: string, input: UpdateClientInput): Promise<ClientDto> {
  assertCanEdit(actor);
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) throw notFound('Client not found');
  await assertClientFree(input.name, input.code, client.id);

  const data: Prisma.ClientUpdateInput = {};
  if (input.name !== undefined) {
    data.name = input.name;
    data.nameKey = toNameKey(input.name);
  }
  if (input.code !== undefined) data.code = input.code;
  if (input.contactName !== undefined) data.contactName = input.contactName;
  if (input.contactPhone !== undefined) data.contactPhone = input.contactPhone;
  if (input.contactEmail !== undefined) data.contactEmail = input.contactEmail;
  if (input.billingEmail !== undefined) data.billingEmail = input.billingEmail;
  if (input.notes !== undefined) data.notes = input.notes;
  if (input.active !== undefined) data.active = input.active;

  const updated = await withDuplicateCheck(
    () => prisma.client.update({ where: { id }, data, include: clientInclude }),
    `A client with this name or code already exists`,
  );
  return toClientDto(updated);
}

// --- Sites ---

export async function addSite(actor: User, clientId: string, input: CreateSiteInput): Promise<ClientSiteDto> {
  assertCanEdit(actor);
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) throw notFound('Client not found');
  await assertSiteFree(clientId, input.name, 'name');
  await requireActiveLocation(input.locationId, 'locationId');

  const site = await withDuplicateCheck(
    () => prisma.clientSite.create({ data: { clientId, ...siteData(input) }, include: siteInclude }),
    duplicateSiteMessage(input.name),
  );
  return toSiteDto(site);
}

const lastActiveSite = () =>
  conflict('LAST_ACTIVE_SITE', 'A client needs at least one active site. Add or activate another site first.');

export async function updateSite(
  actor: User,
  clientId: string,
  siteId: string,
  input: UpdateSiteInput,
): Promise<ClientSiteDto> {
  assertCanEdit(actor);
  const site = await prisma.clientSite.findUnique({ where: { id: siteId } });
  if (!site || site.clientId !== clientId) throw notFound('Site not found');

  if (input.name !== undefined && toNameKey(input.name) !== site.nameKey) {
    await assertSiteFree(clientId, input.name, 'name', site.id);
  }
  if (input.locationId !== undefined && input.locationId !== site.locationId) {
    await requireActiveLocation(input.locationId, 'locationId');
  }

  const data: Prisma.ClientSiteUpdateInput = {};
  if (input.name !== undefined) {
    data.name = input.name;
    data.nameKey = toNameKey(input.name);
  }
  if (input.address !== undefined) data.address = input.address;
  if (input.lat !== undefined) data.lat = input.lat;
  if (input.lng !== undefined) data.lng = input.lng;
  if (input.locationId !== undefined) data.location = { connect: { id: input.locationId } };
  if (input.contactName !== undefined) data.contactName = input.contactName;
  if (input.contactPhone !== undefined) data.contactPhone = input.contactPhone;
  if (input.active !== undefined) data.active = input.active;

  const deactivating = input.active === false && site.active;
  const updated = await withDuplicateCheck(
    () =>
      prisma.$transaction(async (tx) => {
        if (deactivating) {
          // Lock the client row so two concurrent deactivations can't both pass the check.
          await tx.$queryRaw`SELECT id FROM "Client" WHERE id = ${clientId} FOR UPDATE`;
          const others = await tx.clientSite.count({ where: { clientId, active: true, id: { not: site.id } } });
          if (others === 0) throw lastActiveSite();
        }
        return tx.clientSite.update({ where: { id: siteId }, data, include: siteInclude });
      }),
    duplicateSiteMessage(input.name ?? site.name),
  );
  return toSiteDto(updated);
}
