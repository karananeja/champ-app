import request from 'supertest';
import type { Role } from '@champ/shared';
import { createApp } from '../src/app';
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

export function testApi(google: GoogleAuth = fakeGoogle(null)) {
  return request(createApp({ google }));
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
