import type { ApiErrorBody, ErrorCode, MobileAuthResponse } from '@champ/shared';
import { resolveApiOrigin } from './api-base-url';
import { tokenStore } from './token-store';

/** The server answered with an error body. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'UNKNOWN',
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** No response at all: the API isn't reachable (D-008, online only). */
export class NetworkError extends Error {
  readonly kind = 'network' as const;
  constructor() {
    super('No connection');
    this.name = 'NetworkError';
  }
}

export const isNetworkError = (e: unknown): e is NetworkError => e instanceof NetworkError;

let accessToken: string | null = null;
let refreshInFlight: Promise<MobileAuthResponse | null> | null = null;
let onAuthLost: () => void = () => {};

export const setAccessToken = (token: string | null): void => {
  accessToken = token;
};
export const getAccessToken = (): string | null => accessToken;
/** Called when a refresh fails after a 401: the session provider signs out. */
export const setOnAuthLost = (fn: () => void): void => {
  onAuthLost = fn;
};

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Send the access token and refresh on 401 (default true). */
  auth?: boolean;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const qs = query
    ? Object.entries(query)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : '';
  return `${resolveApiOrigin()}/api${path}${qs ? `?${qs}` : ''}`;
}

async function send(path: string, opts: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.auth !== false && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  try {
    return await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new NetworkError();
  }
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const err = (json as ApiErrorBody | undefined)?.error;
    throw new ApiError(res.status, err?.code ?? 'UNKNOWN', err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  return json as T;
}

/**
 * Exchanges the stored refresh token for a new pair. One request at a time: concurrent 401s share it. Resolves
 * null when there's no token or the server refuses it (the stored token is then cleared); throws NetworkError.
 */
export function refreshSession(): Promise<MobileAuthResponse | null> {
  refreshInFlight ??= (async () => {
    try {
      const refreshToken = await tokenStore.get();
      if (!refreshToken) return null;
      const res = await send('/mobile/auth/refresh', { method: 'POST', body: { refreshToken }, auth: false });
      if (!res.ok) {
        await tokenStore.clear();
        accessToken = null;
        return null;
      }
      const body = await parse<MobileAuthResponse>(res);
      accessToken = body.accessToken;
      await tokenStore.set(body.refreshToken);
      return body;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/** JSON request against `/api`. On 401 it refreshes once and retries; if that fails the session is lost. */
export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  let res = await send(path, opts);
  if (res.status === 401 && opts.auth !== false) {
    const refreshed = await refreshSession();
    if (!refreshed) {
      onAuthLost();
      return parse<T>(res);
    }
    res = await send(path, opts);
    if (res.status === 401) onAuthLost();
  }
  return parse<T>(res);
}
