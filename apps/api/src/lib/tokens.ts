import { createHash, randomBytes } from 'node:crypto';

/** 32 random bytes, base64url encoded (43 chars). */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
