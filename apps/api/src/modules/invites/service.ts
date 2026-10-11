import {
  INVITE_TTL_HOURS,
  MANAGER_RULES,
  canInvite,
  type AcceptInviteInput,
  type CreateInviteInput,
  type CreateInviteResponse,
  type InviteDto,
  type InviteLookupResponse,
  type InviteStatus,
} from '@champ/shared';
import { env } from '../../config/env';
import { badRequest, conflict, forbidden, gone, notFound } from '../../lib/errors';
import type { GoogleAuth } from '../../lib/google';
import { hashPassword } from '../../lib/password';
import { prisma, type Invite, type User } from '../../lib/prisma';
import { generateToken, hashToken } from '../../lib/tokens';
import { createSession, verifyGoogleIdentity, type Session } from '../auth/service';
import { requireActiveLocation } from '../masters/refs';
import { resolveManagerId } from '../users/managers';

type InviteWithInviter = Invite & { invitedBy: { id: string; name: string } };

export function inviteStatus(invite: Invite, now = new Date()): InviteStatus {
  if (invite.usedAt) return 'USED';
  if (invite.revokedAt) return 'REVOKED';
  if (invite.expiresAt <= now) return 'EXPIRED';
  return 'PENDING';
}

async function toInviteDtos(invites: InviteWithInviter[]): Promise<InviteDto[]> {
  const managerIds = [...new Set(invites.map((i) => i.managerId).filter((id): id is string => !!id))];
  const managers = await prisma.user.findMany({
    where: { id: { in: managerIds } },
    select: { id: true, name: true },
  });
  const byId = new Map(managers.map((m) => [m.id, m]));
  return invites.map((invite) => ({
    id: invite.id,
    email: invite.email,
    role: invite.role,
    jobTitle: invite.jobTitle,
    status: inviteStatus(invite),
    manager: invite.managerId ? (byId.get(invite.managerId) ?? null) : null,
    invitedBy: invite.invitedBy,
    name: invite.name,
    phone: invite.phone,
    technicianType: invite.technicianType,
    baseLocationId: invite.baseLocationId,
    expiresAt: invite.expiresAt.toISOString(),
    usedAt: invite.usedAt?.toISOString() ?? null,
    revokedAt: invite.revokedAt?.toISOString() ?? null,
    createdAt: invite.createdAt.toISOString(),
  }));
}

const inviterSelect = { invitedBy: { select: { id: true, name: true } } } as const;

export async function createInvite(actor: User, input: CreateInviteInput): Promise<CreateInviteResponse> {
  if (!canInvite(actor.role, input.role)) {
    throw forbidden('ROLE_NOT_INVITABLE', 'You cannot invite a user with this role');
  }

  const email = input.email.toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) {
    throw conflict('EMAIL_EXISTS', 'A user with this email already exists');
  }

  // An OE always invites OTs into their own team. Other inviters default to
  // themselves when they hold the manager role for the invited role.
  let managerId = input.managerId ?? null;
  if (actor.role === 'OE' && input.role === 'OT') managerId = actor.id;
  else if (!managerId && MANAGER_RULES[input.role].required && MANAGER_RULES[input.role].managerRole === actor.role) {
    managerId = actor.id;
  }
  managerId = await resolveManagerId(input.role, managerId);

  // OT invites carry the technician profile (F02); the shared schema makes both fields required for OT.
  const isTechnician = input.role === 'OT';
  if (isTechnician && (!input.technicianType || !input.baseLocationId)) {
    throw badRequest('VALIDATION_ERROR', 'A technician needs a type and a base location');
  }
  if (isTechnician) await requireActiveLocation(input.baseLocationId!);

  const token = generateToken();
  const invite = await prisma.$transaction(async (tx) => {
    // A new invite replaces any outstanding one for the same email.
    await tx.invite.updateMany({
      where: { email, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return tx.invite.create({
      data: {
        email,
        role: input.role,
        managerId,
        jobTitle: input.jobTitle || null,
        name: input.name || null,
        phone: input.phone || null,
        technicianType: isTechnician ? input.technicianType : null,
        baseLocationId: isTechnician ? input.baseLocationId : null,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000),
        invitedById: actor.id,
      },
      include: inviterSelect,
    });
  });

  const [dto] = await toInviteDtos([invite]);
  return { invite: dto!, link: `${env.WEB_URL}/accept-invite?token=${encodeURIComponent(token)}` };
}

export async function listInvites(actor: User): Promise<InviteDto[]> {
  const invites = await prisma.invite.findMany({
    where: actor.role === 'SUPER_ADMIN' ? {} : { invitedById: actor.id },
    include: inviterSelect,
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  return toInviteDtos(invites);
}

export async function revokeInvite(actor: User, id: string): Promise<InviteDto> {
  const invite = await prisma.invite.findUnique({ where: { id } });
  if (!invite) throw notFound('Invite not found');
  if (actor.role !== 'SUPER_ADMIN' && invite.invitedById !== actor.id) throw forbidden();
  if (inviteStatus(invite) !== 'PENDING') throw conflict('INVITE_NOT_PENDING', 'Only pending invites can be revoked');

  const updated = await prisma.invite.update({
    where: { id },
    data: { revokedAt: new Date() },
    include: inviterSelect,
  });
  const [dto] = await toInviteDtos([updated]);
  return dto!;
}

/** Loads a usable invite by raw token, or throws 410 with a specific code. */
async function findUsableInvite(token: string): Promise<InviteWithInviter> {
  const invite = await prisma.invite.findUnique({
    where: { tokenHash: hashToken(token) },
    include: inviterSelect,
  });
  const status = invite ? inviteStatus(invite) : 'INVALID';
  switch (status) {
    case 'PENDING':
      return invite!;
    case 'USED':
      throw gone('INVITE_USED', 'This invite link has already been used. Please sign in instead.');
    case 'EXPIRED':
      throw gone('INVITE_EXPIRED', 'This invite link has expired. Ask the person who invited you for a new one.');
    default:
      throw gone('INVITE_INVALID', 'This invite link is not valid. Ask the person who invited you for a new one.');
  }
}

export async function lookupInvite(token: string): Promise<InviteLookupResponse> {
  const invite = await findUsableInvite(token);
  return {
    email: invite.email,
    role: invite.role,
    inviterName: invite.invitedBy.name,
    name: invite.name,
    phone: invite.phone,
  };
}

interface NewUserFromInvite {
  name: string;
  phone: string | null;
  passwordHash: string | null;
  authProvider: 'PASSWORD' | 'GOOGLE';
}

/** Creates the user and marks the invite used, atomically and at most once. */
async function redeemInvite(invite: Invite, data: NewUserFromInvite): Promise<Session> {
  if (await prisma.user.findUnique({ where: { email: invite.email } })) {
    throw conflict('EMAIL_EXISTS', 'An account with this email already exists. Please sign in.');
  }
  const user = await prisma.$transaction(async (tx) => {
    const { count } = await tx.invite.updateMany({
      where: { id: invite.id, usedAt: null, revokedAt: null },
      data: { usedAt: new Date() },
    });
    if (count === 0) throw gone('INVITE_USED', 'This invite link has already been used. Please sign in instead.');
    return tx.user.create({
      data: {
        email: invite.email,
        role: invite.role,
        managerId: invite.managerId,
        jobTitle: invite.jobTitle,
        technicianType: invite.role === 'OT' ? invite.technicianType : null,
        baseLocationId: invite.role === 'OT' ? invite.baseLocationId : null,
        ...data,
      },
    });
  });
  return createSession(user.id);
}

export async function acceptInvite(input: AcceptInviteInput): Promise<Session> {
  const invite = await findUsableInvite(input.token);
  return redeemInvite(invite, {
    name: input.name,
    phone: input.phone,
    passwordHash: await hashPassword(input.password),
    authProvider: 'PASSWORD',
  });
}

export async function acceptInviteWithGoogle(google: GoogleAuth, token: string, idToken: string): Promise<Session> {
  const invite = await findUsableInvite(token);
  const identity = await verifyGoogleIdentity(google, idToken);
  if (identity.email !== invite.email) {
    throw forbidden('GOOGLE_EMAIL_MISMATCH', `Sign in with the Google account for ${invite.email}`);
  }
  return redeemInvite(invite, {
    name: identity.name?.trim() || invite.name || invite.email.split('@')[0]!,
    phone: invite.phone,
    passwordHash: null,
    authProvider: 'GOOGLE',
  });
}
