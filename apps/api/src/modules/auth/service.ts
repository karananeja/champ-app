import { MOBILE_ROLE_NOT_ALLOWED_MESSAGE, type AuthResponse, type Role } from '@champ/shared';
import { forbidden, unauthorized } from '../../lib/errors';
import type { GoogleAuth, GoogleIdentity } from '../../lib/google';
import { signAccessToken } from '../../lib/jwt';
import { REFRESH_TOKEN_TTL_MS } from '../../lib/cookies';
import { verifyPassword } from '../../lib/password';
import { prisma } from '../../lib/prisma';
import { generateToken, hashToken } from '../../lib/tokens';
import { toUserDto, userWithManager } from '../users/dto';

export interface Session extends AuthResponse {
  /** Raw refresh token, to be set as the httpOnly cookie. */
  refreshToken: string;
}

/** Issues a new access token and a new (stored hashed) refresh token. */
export async function createSession(userId: string): Promise<Session> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: userWithManager });
  const refreshToken = generateToken();
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });
  return {
    accessToken: signAccessToken({ sub: user.id, role: user.role }),
    refreshToken,
    user: toUserDto(user),
  };
}

/** Restricts a sign-in or refresh to some roles (the field app, D-128). */
export interface SessionPolicy {
  roles?: readonly Role[];
}

function assertRoleAllowed(role: Role, policy: SessionPolicy): void {
  if (policy.roles && !policy.roles.includes(role)) {
    throw forbidden('MOBILE_ROLE_NOT_ALLOWED', MOBILE_ROLE_NOT_ALLOWED_MESSAGE);
  }
}

export async function loginWithPassword(email: string, password: string, policy: SessionPolicy = {}): Promise<Session> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  // Same error for unknown email and wrong password to avoid account enumeration.
  const valid = user?.passwordHash ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !valid) throw unauthorized('INVALID_CREDENTIALS', 'Invalid email or password');
  if (user.status !== 'ACTIVE') throw forbidden('ACCOUNT_INACTIVE', 'Your account is inactive');
  assertRoleAllowed(user.role, policy);
  return createSession(user.id);
}

/**
 * Verifies a Google ID token and enforces the company-domain rule.
 * Returns the verified, lowercased email and the display name.
 */
export async function verifyGoogleIdentity(
  google: GoogleAuth,
  idToken: string,
): Promise<{ email: string; name: string | undefined }> {
  if (!google.clientId) {
    throw forbidden('GOOGLE_NOT_CONFIGURED', 'Google sign-in is not configured');
  }
  let identity: GoogleIdentity;
  try {
    identity = await google.verifyIdToken(idToken);
  } catch {
    throw unauthorized('GOOGLE_TOKEN_INVALID', 'Google sign-in failed. Please try again.');
  }
  const email = identity.email?.toLowerCase();
  const domain = google.allowedDomain.toLowerCase();
  if (!email || identity.email_verified !== true || identity.hd?.toLowerCase() !== domain) {
    throw forbidden('GOOGLE_DOMAIN_NOT_ALLOWED', `Only verified @${domain} Google accounts can sign in`);
  }
  return { email, name: identity.name };
}

export async function loginWithGoogle(google: GoogleAuth, idToken: string): Promise<Session> {
  const { email } = await verifyGoogleIdentity(google, idToken);
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw forbidden('GOOGLE_USER_NOT_FOUND', 'No Champ account exists for this Google account. Ask for an invite.');
  }
  if (user.status !== 'ACTIVE') throw forbidden('ACCOUNT_INACTIVE', 'Your account is inactive');
  return createSession(user.id);
}

/**
 * Rotates a refresh token. Presenting a token that was already revoked is treated
 * as theft: every refresh token of that user is revoked.
 */
export async function refreshSession(rawToken: string | undefined, policy: SessionPolicy = {}): Promise<Session> {
  if (!rawToken) throw unauthorized('REFRESH_INVALID', 'No session');
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { user: true },
  });
  if (!stored) throw unauthorized('REFRESH_INVALID', 'Invalid session');

  if (stored.revokedAt) {
    await revokeAllForUser(stored.userId);
    throw unauthorized('REFRESH_REUSED', 'Session is no longer valid. Please sign in again.');
  }
  if (stored.expiresAt <= new Date()) throw unauthorized('REFRESH_INVALID', 'Session expired');
  if (stored.user.status !== 'ACTIVE') {
    await revokeAllForUser(stored.userId);
    throw unauthorized('ACCOUNT_INACTIVE', 'Your account is inactive');
  }
  if (policy.roles && !policy.roles.includes(stored.user.role)) {
    // The role changed since sign-in: end this session and issue no new token.
    await revokeRefreshToken(rawToken);
    assertRoleAllowed(stored.user.role, policy);
  }

  // Conditional update guards against two concurrent rotations of the same token.
  const { count } = await prisma.refreshToken.updateMany({
    where: { id: stored.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (count === 0) {
    await revokeAllForUser(stored.userId);
    throw unauthorized('REFRESH_REUSED', 'Session is no longer valid. Please sign in again.');
  }
  return createSession(stored.userId);
}

export async function revokeRefreshToken(rawToken: string | undefined): Promise<void> {
  if (!rawToken) return;
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllForUser(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
