import request from 'supertest';
import { toNameKey, type LookupKind, type Role, type TechnicianType } from '@champ/shared';
import { createApp, type AppDeps } from '../src/app';
import type { GoogleAuth, GoogleIdentity } from '../src/lib/google';
import { signAccessToken } from '../src/lib/jwt';
import { prisma, type User } from '../src/lib/prisma';
import { hashToken } from '../src/lib/tokens';

export const PASSWORD = 'Passw0rd!';
// A pre-computed bcrypt hash of PASSWORD (cost 4) keeps fixtures fast; login verifies it the same way.
const PASSWORD_HASH = '$2b$04$u2aW3UcLDPFQYTZ0SB10Iuh3Yu7yVavzBYWtj7n4D8sxlRPWLOFFi';

let counter = 0;

interface UserOptions {
  role: Role;
  email?: string;
  name?: string;
  managerId?: string | null;
  status?: 'ACTIVE' | 'INACTIVE';
  canManageUsers?: boolean;
  canManageTaskTypes?: boolean;
  technicianType?: TechnicianType | null;
  baseLocationId?: string | null;
}

export async function createUser(options: UserOptions): Promise<User> {
  counter += 1;
  return prisma.user.create({
    data: {
      email: options.email ?? `${options.role.toLowerCase()}${counter}@intellicar.in`,
      name: options.name ?? `${options.role} User ${counter}`,
      role: options.role,
      managerId: options.managerId ?? null,
      status: options.status ?? 'ACTIVE',
      passwordHash: PASSWORD_HASH,
      canManageUsers: options.canManageUsers ?? false,
      canManageTaskTypes: options.canManageTaskTypes ?? false,
      technicianType: options.technicianType ?? null,
      baseLocationId: options.baseLocationId ?? null,
    },
  });
}

/** Creates one user of each role with a valid hierarchy: OM → OE → OT, plus SA and RO. */
export async function createOrg() {
  const sa = await createUser({ role: 'SUPER_ADMIN' });
  const om = await createUser({ role: 'OM' });
  const oe = await createUser({ role: 'OE', managerId: om.id });
  const ot = await createUser({ role: 'OT', managerId: oe.id });
  const ro = await createUser({ role: 'RO' });
  return { sa, om, oe, ot, ro, SUPER_ADMIN: sa, OM: om, OE: oe, OT: ot, RO: ro } as const;
}

export const bearer = (user: User) => ({ Authorization: `Bearer ${signAccessToken({ sub: user.id, role: user.role })}` });

export interface FakeGoogle extends GoogleAuth {
  /** The identity the next verifyIdToken call returns (or null to throw). */
  identity: GoogleIdentity | null;
}

export function fakeGoogle(clientId: string | null = 'test-client-id.apps.googleusercontent.com'): FakeGoogle {
  const fake: FakeGoogle = {
    clientId,
    allowedDomain: 'intellicar.in',
    identity: null,
    async verifyIdToken() {
      if (!fake.identity) throw new Error('invalid token');
      return fake.identity;
    },
  };
  return fake;
}

export function testApi(google: GoogleAuth = fakeGoogle(null), deps: Omit<AppDeps, 'google'> = {}) {
  return request(createApp({ google, ...deps }));
}

/** Extracts the raw champ_rt cookie value from a response. */
export function refreshCookie(res: request.Response): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = raw?.find((c) => c.startsWith('champ_rt='));
  const value = cookie?.split(';')[0]?.slice('champ_rt='.length);
  return value || undefined;
}

/** Inserts an invite directly, returning the raw token. */
export async function insertInvite(options: {
  invitedById: string;
  email?: string;
  role?: Role;
  managerId?: string | null;
  expiresAt?: Date;
  usedAt?: Date | null;
  revokedAt?: Date | null;
}) {
  counter += 1;
  const token = `raw-token-${counter}-${Date.now()}`;
  const invite = await prisma.invite.create({
    data: {
      email: options.email ?? `invitee${counter}@intellicar.in`,
      role: options.role ?? 'RO',
      managerId: options.managerId ?? null,
      tokenHash: hashToken(token),
      expiresAt: options.expiresAt ?? new Date(Date.now() + 72 * 3600 * 1000),
      usedAt: options.usedAt ?? null,
      revokedAt: options.revokedAt ?? null,
      invitedById: options.invitedById,
    },
  });
  return { invite, token };
}

export function tokenFromLink(link: string): string {
  const token = new URL(link).searchParams.get('token');
  if (!token) throw new Error(`No token in ${link}`);
  return token;
}

// --- Master data fixtures (F02) ---

export async function createLookup(kind: LookupKind, name: string, extra: { active?: boolean; isSystem?: boolean; code?: string; billable?: boolean; sortOrder?: number } = {}) {
  return prisma.lookupItem.create({
    data: {
      kind,
      name,
      nameKey: toNameKey(name),
      active: extra.active ?? true,
      isSystem: extra.isSystem ?? false,
      code: extra.code ?? null,
      billable: kind === 'FINAL_ISSUE' ? (extra.billable ?? false) : null,
      sortOrder: extra.sortOrder ?? 0,
    },
  });
}

/** Creates a location (with its own state and region unless given). */
export async function createLocation(
  options: { city?: string; stateId?: string; regionId?: string; active?: boolean } = {},
) {
  counter += 1;
  const stateId = options.stateId ?? (await createLookup('STATE', `State ${counter}`)).id;
  const regionId = options.regionId ?? (await createLookup('REGION', `Region ${counter}`)).id;
  const city = options.city ?? `City ${counter}`;
  return prisma.location.create({
    data: { city, cityKey: toNameKey(city), stateId, regionId, active: options.active ?? true },
  });
}

/** Valid technician fields for an OT invite. */
export async function technicianFields(type: TechnicianType = 'PAYROLL') {
  const location = await createLocation();
  return { technicianType: type, baseLocationId: location.id };
}

// --- Task fixtures (F04) ---

/**
 * An org plus the masters, client and technicians a task needs: task type OT, Vehicle/Battery asset types
 * with one activity each, LAF5, a make/model, GPS installation, Day/Night shifts, one issue, client Zoomcar
 * (code ZOOM) with two sites, a second client, and two technicians (Payroll, Third party).
 */
export async function createTaskWorld() {
  const org = await createOrg();
  const taskType = await createLookup('TASK_TYPE', 'OT', { code: 'OT', isSystem: true });
  const vehicle = await createLookup('ASSET_TYPE', 'Vehicle', { code: 'VEHICLE', isSystem: true });
  const battery = await createLookup('ASSET_TYPE', 'Battery', { code: 'BATTERY', isSystem: true });
  const activity = async (name: string, assetTypeId: string, active = true) =>
    prisma.activity.create({ data: { name, nameKey: toNameKey(name), assetTypeId, active } });
  const vehicleInstall = await activity('New installation', vehicle.id);
  const batteryInstall = await activity('New installation', battery.id);
  const laf5 = await createLookup('DEVICE_TYPE', 'LAF5', { code: 'LAF5' });
  const makeModel = await prisma.vehicleMakeModel.create({ data: { make: 'Tata', model: 'Ace', key: 'tata|ace' } });
  const gps = await createLookup('INSTALLATION_TYPE', 'GPS');
  const day = await createLookup('SHIFT_TYPE', 'Day', { code: 'DAY', isSystem: true, sortOrder: 1 });
  const night = await createLookup('SHIFT_TYPE', 'Night', { code: 'NIGHT', isSystem: true, sortOrder: 2 });
  const issue = await createLookup('ISSUE_REPORTED', 'Device not reporting');
  const location = await createLocation({ city: 'Bengaluru' });
  const pune = await createLocation({ city: 'Pune' });
  // F06: verification masters.
  const observed = await createLookup('ISSUE_OBSERVED', 'Loose wiring');
  const actionTaken = await createLookup('ACTION_TAKEN', 'Rewired power supply');
  const billableIssue = await createLookup('FINAL_ISSUE', 'Wiring issue', { billable: true });
  const freeIssue = await createLookup('FINAL_ISSUE', 'Device fault', { billable: false });
  const relay = await createLookup('ACCESSORY', 'Relay');
  const buzzer = await createLookup('ACCESSORY', 'Buzzer');

  const client = await prisma.client.create({
    data: {
      name: 'Zoomcar',
      nameKey: 'zoomcar',
      code: 'ZOOM',
      contactName: 'Priya Rao',
      contactPhone: '+91 98765 43210',
      contactEmail: 'priya@zoom.example',
      createdById: org.sa.id,
      sites: {
        create: [
          { name: 'Bengaluru depot', nameKey: 'bengaluru depot', address: 'MG Road', lat: 12.97, lng: 77.59, locationId: location.id },
          { name: 'Pune yard', nameKey: 'pune yard', address: 'Hinjewadi', lat: 18.59, lng: 73.73, locationId: pune.id },
        ],
      },
    },
    include: { sites: { orderBy: { name: 'asc' } } },
  });
  const otherClient = await prisma.client.create({
    data: {
      name: 'Other Fleet',
      nameKey: 'other fleet',
      contactName: 'Ravi',
      contactPhone: '+91 90000 11111',
      createdById: org.sa.id,
      sites: { create: [{ name: 'Delhi hub', nameKey: 'delhi hub', address: 'Okhla', lat: 28.5, lng: 77.2, locationId: location.id }] },
    },
    include: { sites: true },
  });

  const techA = await createUser({
    role: 'OT',
    name: 'Arjun Tech',
    email: 'arjun.ot@intellicar.in',
    managerId: org.oe.id,
    technicianType: 'PAYROLL',
    baseLocationId: location.id,
  });
  const techB = await createUser({
    role: 'OT',
    name: 'Bhavna Tech',
    email: 'bhavna.ot@intellicar.in',
    managerId: org.oe.id,
    technicianType: 'THIRD_PARTY',
    baseLocationId: pune.id,
  });

  /** A valid `POST /tasks` body (Vehicle, 2 vehicles by count, no technician, the org's OE). */
  const taskBody = (overrides: Record<string, unknown> = {}) => ({
    clientId: client.id,
    siteId: client.sites[0]!.id,
    pocName: 'Priya Rao',
    pocPhone: '+91 98765 43210',
    pocEmail: '',
    oeId: org.oe.id,
    technicianType: null,
    assetTypeId: vehicle.id,
    activityId: vehicleInstall.id,
    deviceTypeId: laf5.id,
    makeModelId: makeModel.id,
    installationTypeId: gps.id,
    requestedAt: '2026-10-20T04:30:00.000Z',
    fitmentAt: '2026-10-21T05:00:00.000Z',
    shiftTypeId: day.id,
    issueReportedId: issue.id,
    gpsAddress: '',
    comments: '',
    vehicles: { entry: 'COUNT', count: 2 },
    technicianId: null,
    ...overrides,
  });

  return {
    ...org,
    observed,
    actionTaken,
    billableIssue,
    freeIssue,
    relay,
    buzzer,
    /** F06: the required verification fields (D-098), for a VERIFY payload (billable final issue). */
    verification: { issueObservedId: observed.id, actionTakenId: actionTaken.id, finalIssueId: billableIssue.id },
    taskType,
    vehicle,
    battery,
    vehicleInstall,
    batteryInstall,
    laf5,
    makeModel,
    gps,
    day,
    night,
    issue,
    location,
    pune,
    client,
    otherClient,
    techA,
    techB,
    taskBody,
  };
}
