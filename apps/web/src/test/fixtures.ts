import { vi } from 'vitest';
import type { LookupsResponse, UserDto } from '@champ/shared';

export function makeUser(overrides: Partial<UserDto> = {}): UserDto {
  return {
    id: 'user-1',
    email: 'user@intellicar.in',
    name: 'Test User',
    phone: null,
    jobTitle: null,
    role: 'OM',
    status: 'ACTIVE',
    authProvider: 'PASSWORD',
    managerId: null,
    manager: null,
    canManageUsers: false,
    canManageTaskTypes: false,
    technicianType: null,
    baseLocationId: null,
    createdAt: '2026-10-11T00:00:00.000Z',
    ...overrides,
  };
}

const opt = (id: string, name: string, code: string | null = null) => ({ id, name, code });

export const lookupsFixture: LookupsResponse = {
  assetTypes: [opt('at-vehicle', 'Vehicle', 'VEHICLE'), opt('at-battery', 'Battery', 'BATTERY')],
  activities: [],
  deviceTypes: [opt('dt-laf5', 'LAF5', 'LAF5')],
  makeModels: [],
  installationTypes: [],
  states: [opt('st-ka', 'Karnataka'), opt('st-mh', 'Maharashtra')],
  regions: [opt('rg-south', 'South'), opt('rg-west', 'West')],
  locations: [
    { id: 'loc-blr', city: 'Bengaluru', stateId: 'st-ka', stateName: 'Karnataka', regionId: 'rg-south', regionName: 'South' },
    { id: 'loc-pune', city: 'Pune', stateId: 'st-mh', stateName: 'Maharashtra', regionId: 'rg-west', regionName: 'West' },
  ],
  issuesReported: [],
  issuesObserved: [],
  actionsTaken: [],
  finalIssues: [],
  accessories: [],
  closeReasons: [],
  shiftTypes: [],
  taskTypes: [],
  technicianTypes: [
    { value: 'PAYROLL', label: 'Payroll' },
    { value: 'THIRD_PARTY', label: 'Third party' },
    { value: 'CONTRACTUAL', label: 'Contractual' },
  ],
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Route = (url: string, init: RequestInit) => unknown;

/**
 * Stubs `fetch` with routes keyed by "METHOD /path" (query string ignored). A route is a JSON body, a
 * function returning one, or a `Response`. `/api/lookups` defaults to `lookupsFixture`. Returns the mock
 * so tests can inspect calls.
 */
export function mockApi(routes: Record<string, Route | unknown>) {
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = url.split('?')[0];
    const key = `${init.method ?? 'GET'} ${path}`;
    const route = key in routes ? routes[key] : key === 'GET /api/lookups' ? lookupsFixture : undefined;
    if (route === undefined) return json({ error: { code: 'NOT_FOUND', message: `No mock for ${key}` } }, 404);
    const body = typeof route === 'function' ? (route as Route)(url, init) : route;
    if (body instanceof Response) return body;
    return json(body, init.method === 'POST' ? 201 : 200);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Parsed JSON bodies of the calls to `METHOD /path`. */
export function callsTo(fetchMock: ReturnType<typeof mockApi>, method: string, path: string): unknown[] {
  return fetchMock.mock.calls
    .filter(([url, init]) => url.split('?')[0] === path && ((init?.method as string | undefined) ?? 'GET') === method)
    .map(([, init]) => (init?.body ? JSON.parse(init.body as string) : undefined));
}
