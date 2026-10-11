import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AuthResponse, LoginInput, UserDto } from '@champ/shared';
import { api, refreshSession, setAccessToken, setSessionListener } from '@/lib/api';
import { AuthContext, type AuthStatus } from '@/lib/auth';

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<UserDto | null>(null);

  const applySession = useCallback((session: AuthResponse | null) => {
    setAccessToken(session?.accessToken ?? null);
    setUser(session?.user ?? null);
    setStatus(session ? 'authenticated' : 'anonymous');
  }, []);

  useEffect(() => {
    setSessionListener(applySession);
    // Restore the session from the refresh cookie on load.
    void refreshSession();
    return () => setSessionListener(null);
  }, [applySession]);

  const startSession = useCallback(
    (session: AuthResponse) => {
      queryClient.clear();
      applySession(session);
    },
    [applySession, queryClient],
  );

  const login = useCallback(
    async (input: LoginInput) => {
      const session = await api<AuthResponse>('/auth/login', { method: 'POST', body: input });
      startSession(session);
      return session.user;
    },
    [startSession],
  );

  const loginWithGoogle = useCallback(
    async (idToken: string) => {
      const session = await api<AuthResponse>('/auth/google', { method: 'POST', body: { idToken } });
      startSession(session);
      return session.user;
    },
    [startSession],
  );

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      queryClient.clear();
      applySession(null);
    }
  }, [applySession, queryClient]);

  const value = useMemo(
    () => ({ status, user, login, loginWithGoogle, startSession, logout }),
    [status, user, login, loginWithGoogle, startSession, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

