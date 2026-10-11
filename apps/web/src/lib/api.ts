import type { ApiErrorBody, AuthResponse, ErrorCode } from '@champ/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK_ERROR',
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field errors from a 400 VALIDATION_ERROR response. */
  get fieldErrors(): Record<string, string[] | undefined> {
    const details = this.details as { fieldErrors?: Record<string, string[]> } | undefined;
    return details?.fieldErrors ?? {};
  }
}

// The access token lives in memory only; the refresh token is an httpOnly cookie.
let accessToken: string | null = null;
let onSessionChange: ((session: AuthResponse | null) => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

/** Lets the auth provider learn about refreshes and expiries that happen inside `api()`. */
export function setSessionListener(listener: typeof onSessionChange) {
  onSessionChange = listener;
}

async function parseError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
  if (body?.error) return new ApiError(res.status, body.error.code, body.error.message, body.error.details);
  return new ApiError(res.status, 'INTERNAL_ERROR', `Request failed (${res.status})`);
}

async function rawFetch(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`/api${path}`, { credentials: 'same-origin', ...init });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection.');
  }
}

let refreshInFlight: Promise<AuthResponse | null> | null = null;

async function doRefresh(): Promise<AuthResponse | null> {
  const res = await rawFetch('/auth/refresh', { method: 'POST' });
  if (!res.ok) return null;
  return (await res.json()) as AuthResponse;
}

/**
 * Exchanges the refresh cookie for a new access token. Single-flight within a tab,
 * and serialized across tabs with the Web Locks API so two tabs never rotate the
 * same refresh token (which the server would treat as token reuse).
 */
export function refreshSession(): Promise<AuthResponse | null> {
  refreshInFlight ??= (async () => {
    try {
      const session =
        typeof navigator !== 'undefined' && navigator.locks
          ? await navigator.locks.request('champ-refresh', doRefresh)
          : await doRefresh();
      setAccessToken(session?.accessToken ?? null);
      onSessionChange?.(session);
      return session;
    } catch {
      setAccessToken(null);
      onSessionChange?.(null);
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined | null>;
}

/** Calls the API, retrying once after a token refresh on 401. Throws ApiError. */
export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const url = params.size ? `${path}?${params}` : path;

  const send = () => {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return rawFetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  };

  let res = await send();
  if (res.status === 401 && !path.startsWith('/auth/')) {
    const session = await refreshSession();
    if (session) res = await send();
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
