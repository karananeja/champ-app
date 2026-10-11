import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env';

/** The subset of Google ID-token claims we rely on. */
export interface GoogleIdentity {
  email?: string;
  email_verified?: boolean;
  hd?: string;
  name?: string;
}

export interface GoogleAuth {
  /** Null when Google sign-in is not configured. */
  clientId: string | null;
  allowedDomain: string;
  /** Verifies the ID token signature and audience; throws if invalid. */
  verifyIdToken(idToken: string): Promise<GoogleIdentity>;
}

export function createGoogleAuth(): GoogleAuth {
  const clientId = env.GOOGLE_CLIENT_ID ?? null;
  const client = new OAuth2Client();
  return {
    clientId,
    allowedDomain: env.GOOGLE_ALLOWED_DOMAIN,
    async verifyIdToken(idToken) {
      if (!clientId) throw new Error('Google sign-in is not configured');
      const ticket = await client.verifyIdToken({ idToken, audience: clientId });
      return ticket.getPayload() ?? {};
    },
  };
}
