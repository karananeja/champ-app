import type { LoginInput, MobileAuthResponse, UserDto } from '@champ/shared';
import { isHomeLocationRequired } from '@champ/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, isNetworkError, refreshSession, setAccessToken, setOnAuthLost } from './api-client';
import { tokenStore } from './token-store';

export type SessionStatus = 'loading' | 'offline' | 'signed-out' | 'signed-in';

export interface Session {
  status: SessionStatus;
  user: UserDto | null;
  /** Show the home-location screen before the app: OT without one, or an OE right after sign-in who hasn't skipped. */
  needsHomeLocation: boolean;
  signIn(input: LoginInput): Promise<void>;
  signOut(): Promise<void>;
  /** Launch/Retry: refresh, then `GET /me`. */
  restore(): Promise<void>;
  setUser(user: UserDto): void;
  /** OE only: leave onboarding without a home location. */
  skipHomeLocation(): void;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [user, setUserState] = useState<UserDto | null>(null);
  // OE: offered once, right after an interactive sign-in (D-129: optional for OE).
  const [offerOptionalHome, setOfferOptionalHome] = useState(false);

  const clearLocal = useCallback(async () => {
    setAccessToken(null);
    await tokenStore.clear();
    queryClient.clear();
    setUserState(null);
    setOfferOptionalHome(false);
    setStatus('signed-out');
  }, [queryClient]);

  // Every setState here follows an await, so the launch effect can call it directly.
  const loadSession = useCallback(async () => {
    try {
      const refreshed = await refreshSession();
      if (!refreshed) {
        setStatus('signed-out');
        return;
      }
      const me = await api<UserDto>('/me');
      setUserState(me);
      setStatus('signed-in');
    } catch (e) {
      if (isNetworkError(e)) setStatus('offline');
      else await clearLocal();
    }
  }, [clearLocal]);

  const restore = useCallback(async () => {
    setStatus('loading');
    await loadSession();
  }, [loadSession]);

  useEffect(() => {
    setOnAuthLost(() => void clearLocal());
    // Launch: refresh, then GET /me (D-133).
    void Promise.resolve().then(loadSession);
  }, [clearLocal, loadSession]);

  const signIn = useCallback(async (input: LoginInput) => {
    const res = await api<MobileAuthResponse>('/mobile/auth/login', { method: 'POST', body: input, auth: false });
    setAccessToken(res.accessToken);
    await tokenStore.set(res.refreshToken);
    setUserState(res.user);
    setOfferOptionalHome(!res.user.homeLocation);
    setStatus('signed-in');
  }, []);

  const signOut = useCallback(async () => {
    const refreshToken = await tokenStore.get();
    if (refreshToken) {
      try {
        await api('/mobile/auth/logout', { method: 'POST', body: { refreshToken }, auth: false });
      } catch {
        // Signing out locally must work offline too; the token expires on its own.
      }
    }
    await clearLocal();
  }, [clearLocal]);

  const value = useMemo<Session>(() => {
    const needsHomeLocation =
      status === 'signed-in' &&
      !!user &&
      !user.homeLocation &&
      (isHomeLocationRequired(user.role) || offerOptionalHome);
    return {
      status,
      user,
      needsHomeLocation,
      signIn,
      signOut,
      restore,
      setUser: (u) => {
        setUserState(u);
        if (u.homeLocation) setOfferOptionalHome(false);
      },
      skipHomeLocation: () => setOfferOptionalHome(false),
    };
  }, [status, user, offerOptionalHome, signIn, signOut, restore]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}
