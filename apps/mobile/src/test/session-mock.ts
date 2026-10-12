import type { Session } from '../lib/session';
import { makeUser } from './utils';

/** A Session for screen tests; pair with `jest.mock('../lib/session')`. */
export function fakeSession(overrides: Partial<Session> = {}): Session {
  return {
    status: 'signed-in',
    user: makeUser(),
    needsHomeLocation: false,
    signIn: jest.fn(),
    signOut: jest.fn(async () => {}),
    restore: jest.fn(async () => {}),
    setUser: jest.fn(),
    skipHomeLocation: jest.fn(),
    ...overrides,
  };
}
