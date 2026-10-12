import { vi } from 'vitest';
import type { FitmentDto, LookupsResponse, TaskDto, UserDto } from '@champ/shared';

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
  clients: [],
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

// --- Tasks (F04/F05) ---

export function makeFitment(overrides: Partial<FitmentDto> = {}): FitmentDto {
  return {
    id: 'fit-1',
    tkId: 'TK-00001',
    seq: 1,
    status: 'ASSIGNED',
    technician: { id: 'ot-1', name: 'Ravi Kumar', technicianType: 'PAYROLL' },
    vehicleRegNo: 'KA01AB1234',
    chassisNo: null,
    assetNumber: null,
    oldDeviceId: null,
    availableActions: [],
    canEditData: false,
    startedAt: null,
    startLat: null,
    startLng: null,
    submittedAt: null,
    verifiedAt: null,
    verifiedBy: null,
    approvedAt: null,
    approvedBy: null,
    closedAt: null,
    closeReason: null,
    closeComments: null,
    faultyAt: null,
    faultReason: null,
    replacementOf: null,
    replacement: null,
    reopenCount: 0,
    lastReopenReason: null,
    lastReopenedAt: null,
    ...overrides,
  };
}

const taskRef = (id: string, name: string, code: string | null = null) => ({ id, name, code, active: true });

export function makeTask(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: 'task-1',
    omId: 'OM-00001',
    oeTaskId: 'OE-00001',
    status: 'IN_PROGRESS',
    taskType: taskRef('tt-ot', 'OT', 'OT'),
    client: taskRef('cl-zoom', 'Zoomcar', 'ZOOM'),
    site: { id: 'site-blr', name: 'Bengaluru depot', address: 'MG Road', lat: 12.97, lng: 77.59, active: true },
    location: { id: 'loc-blr', city: 'Bengaluru', state: 'Karnataka' },
    pocName: 'Priya Rao',
    pocPhone: '+91 98765 43210',
    pocEmail: null,
    oeId: 'oe-1',
    oe: { id: 'oe-1', name: 'Esha Exec', active: true },
    technicianType: null,
    assetType: taskRef('at-vehicle', 'Vehicle', 'VEHICLE'),
    activity: taskRef('act-1', 'New installation'),
    deviceType: taskRef('dt-laf5', 'LAF5', 'LAF5'),
    makeModel: null,
    installationType: taskRef('it-gps', 'GPS'),
    requestedAt: '2026-10-20T04:30:00.000Z',
    fitmentAt: '2026-10-21T05:00:00.000Z',
    shiftType: taskRef('sh-day', 'Day', 'DAY'),
    issueReported: taskRef('iss-1', 'Device not reporting'),
    gpsAddress: null,
    comments: null,
    vehicleEntry: 'COUNT',
    counts: { total: 1, assigned: 1, open: 0 },
    fitments: [makeFitment()],
    createdBy: { id: 'om-1', name: 'Maya Manager' },
    createdAt: '2026-10-11T00:00:00.000Z',
    updatedAt: '2026-10-11T00:00:00.000Z',
    completedAt: null,
    permissions: { canEdit: false, canAssign: false, canDelete: false, canViewHistory: false },
    ...overrides,
  };
}
