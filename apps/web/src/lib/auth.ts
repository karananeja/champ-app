import { createContext, useContext } from 'react';
import type { AuthResponse, LoginInput, UserDto } from '@champ/shared';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface AuthContextValue {
  status: AuthStatus;
  user: UserDto | null;
  login: (input: LoginInput) => Promise<UserDto>;
  loginWithGoogle: (idToken: string) => Promise<UserDto>;
  /** Stores a session returned by another endpoint (e.g. accept invite). */
  startSession: (session: AuthResponse) => void;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** The signed-in user; only call inside protected routes. */
export function useCurrentUser(): UserDto {
  const { user } = useAuth();
  if (!user) throw new Error('useCurrentUser called without a signed-in user');
  return user;
}
