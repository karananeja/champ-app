import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FITMENT_STATUSES, ROLES, type AnalyticsResponse, type BillingReportResponse, type Role } from '@champ/shared';
import { App } from '@/app';
import { navGroupsFor } from '@/components/layout/nav';
import { AuthContext, type AuthContextValue } from '@/lib/auth';
import { makeUser, mockApi } from '@/test/fixtures';
import { defaultBillingMonth, formatMonth, sortRows, thisMonthRange } from './report-utils';

const billing: BillingReportResponse = {
  month: '2026-10',
  totals: { billable: 2, nonBillable: 1 },
  clients: [
    {
      clientId: 'c1',
      client: 'Acme Logistics',
      billableCount: 2,
      nonBillableCount: 1,
      rows: ['TK-00001', 'TK-00002'].map((tkId, i) => ({
        fitmentId: `f${i}`,
        tkId,
        taskId: 't1',
        omId: 'OM-00001',
        site: 'Pune depot',
        vehicleRegNo: `MH12AB000${i}`,
        chassisNo: null,
        deviceId: `DEV${i}`,
        activity: 'New installation',
        technician: 'Ravi',
        finalIssue: 'Installed',
        verifiedAt: '2026-10-05T06:00:00.000Z',
        approvedAt: '2026-10-06T06:00:00.000Z',
      })),
    },
  ],
};

const pct = { count: 2, medianHours: 4.5, p90Hours: 9 };
const analytics: AnalyticsResponse = {
  from: '2026-10-01',
  to: '2026-10-12',
  statusCounts: FITMENT_STATUSES.map((status) => ({ status, count: status === 'SUBMITTED' ? 3 : status === 'OM_APPROVED' ? 2 : 0 })),
  turnaround: { field: pct, endToEnd: { count: 2, medianHours: 30, p90Hours: 48 } },
  reopenRate: { reopens: 1, submitted: 4, rate: 0.25 },
  fitmentsPerTechnicianPerDay: { submitted: 4, technicianDays: 2, average: 2 },
  faultyRate: { movedToFt: 1, started: 5, rate: 0.2 },
  km: { total: 42.3, approx: true },
  weekly: [
    { weekStart: '2026-09-28', submitted: 1, approved: 0, reopens: 0, movedToFt: 0, started: 2, km: 10 },
    { weekStart: '2026-10-05', submitted: 3, approved: 2, reopens: 1, movedToFt: 1, started: 3, km: 32.3 },
  ],
  technicians: [
    {
      user: { id: 'u1', name: 'Arjun' },
      started: 1,
      submitted: 1,
      workingDays: 1,
      fitmentsPerDay: 1,
      reopens: 0,
      reopenRate: 0,
      movedToFt: 0,
      faultyRate: 0,
      km: 2,
      kmApprox: false,
      fieldTat: pct,
    },
    {
      user: { id: 'u2', name: 'Bala' },
      started: 4,
      submitted: 3,
      workingDays: 1,
      fitmentsPerDay: 3,
      reopens: 1,
      reopenRate: 0.3333,
      movedToFt: 1,
      faultyRate: 0.25,
      km: 40.3,
      kmApprox: true,
      fieldTat: pct,
    },
  ],
  oes: [{ user: { id: 'oe1', name: 'Esha' }, verified: 3, reopens: 1, reopenRate: 0.3333, endToEndTat: pct }],
};

function renderAt(path: string, role: Role = 'OM', routes: Record<string, unknown> = {}) {
  const fetchMock = mockApi({
    'GET /api/reports/billing': (url: string) =>
      new URL(url, 'http://x').searchParams.get('format') === 'csv'
        ? new Response('client\nAcme', { headers: { 'Content-Disposition': 'attachment; filename="billing-2026-10.csv"' } })
        : billing,
    'GET /api/reports/analytics': (url: string) =>
      new URL(url, 'http://x').searchParams.get('format') === 'csv'
        ? new Response('technician\nArjun', { headers: { 'Content-Disposition': 'attachment; filename="analytics-technicians.csv"' } })
        : analytics,
    'GET /api/tasks/options': { oes: [{ id: 'oe1', name: 'Esha' }], technicians: [], assignableOes: [] },
    ...routes,
  });
  const auth: AuthContextValue = {
    status: 'authenticated',
    user: makeUser({ role, name: 'Test User' }),
    login: vi.fn(),
    loginWithGoogle: vi.fn(),
    startSession: vi.fn(),
    logout: vi.fn(),
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return { fetchMock, user: userEvent.setup() };
}

/** Query params of the calls to a report endpoint. */
const paramsOf = (fetchMock: ReturnType<typeof mockApi>, path: string) =>
  fetchMock.mock.calls.filter(([url]) => (url as string).split('?')[0] === path).map(([url]) => new URL(url as string, 'http://x').searchParams);

describe('report helpers', () => {
  it('defaults the billing month to the previous month in the first 5 days', () => {
    expect(defaultBillingMonth('2026-10-05')).toBe('2026-09');
    expect(defaultBillingMonth('2026-01-03')).toBe('2025-12');
    expect(defaultBillingMonth('2026-10-06')).toBe('2026-10');
    expect(thisMonthRange('2026-10-12')).toEqual({ from: '2026-10-01', to: '2026-10-12' });
  });

  it('sorts with nulls last both ways', () => {
    const rows = [{ v: 2 }, { v: null }, { v: 5 }];
    expect(sortRows(rows, (r) => r.v, 'asc').map((r) => r.v)).toEqual([2, 5, null]);
    expect(sortRows(rows, (r) => r.v, 'desc').map((r) => r.v)).toEqual([5, 2, null]);
  });
});

describe('Reports nav (D-267)', () => {
  it('shows Billing to SA/OM/RO and Analytics also to OE, after Tasks', () => {
    for (const role of ROLES) {
      const groups = navGroupsFor(makeUser({ role }));
      const links = groups.flatMap((g) => g.items.map((i) => i.to));
      expect(links.includes('/reports/billing'), role).toBe(['SUPER_ADMIN', 'OM', 'RO'].includes(role));
      expect(links.includes('/reports/analytics'), role).toBe(role !== 'OT');
      const reports = groups.findIndex((g) => g.label === 'Reports');
      if (role !== 'OT') expect(groups[reports - 1]?.items[0]?.label, role).toBe('Tasks');
    }
  });
});

describe('Billing page (F15)', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('loads the default month, shows groups with counts and rows, and downloads the CSV', async () => {
    const { fetchMock, user } = renderAt('/reports/billing');
    expect(await screen.findByRole('heading', { name: 'Billing' })).toBeInTheDocument();
    const group = await screen.findByTestId('billing-group');
    expect(within(group).getByText('Acme Logistics')).toBeInTheDocument();
    expect(within(group).getByTestId('billable-count')).toHaveTextContent('2 billable');
    expect(within(group).getByText('1 non-billable')).toBeInTheDocument();
    expect(within(group).getAllByTestId('billing-row')).toHaveLength(2);
    expect(screen.getByTestId('total-billable')).toHaveTextContent('2');
    expect(paramsOf(fetchMock, '/api/reports/billing')[0]?.get('month')).toBe(defaultBillingMonth());
    expect(screen.getByRole('combobox', { name: 'Billing month' })).toHaveTextContent(formatMonth(defaultBillingMonth()));

    // Collapsing hides the rows.
    await user.click(within(group).getByRole('button', { name: /Acme Logistics/ }));
    expect(within(group).queryAllByTestId('billing-row')).toHaveLength(0);

    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await user.click(screen.getByRole('button', { name: 'Download CSV' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    const csv = paramsOf(fetchMock, '/api/reports/billing').find((p) => p.get('format') === 'csv');
    expect(csv?.get('month')).toBe(defaultBillingMonth());
    await user.click(screen.getByRole('button', { name: 'Download Excel' }));
    await waitFor(() => expect(paramsOf(fetchMock, '/api/reports/billing').some((p) => p.get('format') === 'xlsx')).toBe(true));
    click.mockRestore();
  });

  it('shows the empty state for a month with nothing approved', async () => {
    renderAt('/reports/billing', 'RO', { 'GET /api/reports/billing': { month: '2026-10', clients: [], totals: { billable: 0, nonBillable: 0 } } });
    expect(await screen.findByText(/Nothing to bill for/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeDisabled();
  });

  it('is forbidden for an OE', async () => {
    renderAt('/reports/billing', 'OE');
    expect(await screen.findByText(/403|permission|access/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Billing' })).not.toBeInTheDocument();
  });
});

describe('Analytics page (F15)', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('queries this month, renders the tiles and the tables, and sorts', async () => {
    const { fetchMock, user } = renderAt('/reports/analytics');
    expect(await screen.findByRole('heading', { name: 'Analytics' })).toBeInTheDocument();
    expect(await screen.findByTestId('kpi-reopen-rate')).toHaveTextContent('25%');
    const params = paramsOf(fetchMock, '/api/reports/analytics')[0]!;
    expect(params.get('from')).toBe(thisMonthRange().from);
    expect(params.get('to')).toBe(thisMonthRange().to);
    expect(params.has('clientId')).toBe(false);

    expect(screen.getByTestId('status-SUBMITTED')).toHaveTextContent('3');
    expect(screen.getByTestId('kpi-field-tat')).toHaveTextContent('4.5 h median');
    expect(screen.getByTestId('kpi-field-tat')).toHaveTextContent('P90 9 h');
    expect(screen.getByTestId('kpi-per-day')).toHaveTextContent('2');
    expect(screen.getByTestId('kpi-faulty-rate')).toHaveTextContent('20%');
    expect(screen.getByTestId('kpi-km')).toHaveTextContent('≈ 42.3 km');

    const names = () => screen.getAllByTestId('technician-row').map((r) => r.querySelector('td')?.textContent);
    expect(names()).toEqual(['Arjun', 'Bala']);
    const table = screen.getByRole('table', { name: 'Technicians' });
    await user.click(within(table).getByRole('button', { name: /^Submitted/ }));
    expect(names()).toEqual(['Bala', 'Arjun']);
    expect(within(table).getByRole('columnheader', { name: /Submitted/ })).toHaveAttribute('aria-sort', 'descending');
    await user.click(within(table).getByRole('button', { name: /^Submitted/ }));
    expect(names()).toEqual(['Arjun', 'Bala']);
    expect(screen.getAllByTestId('oe-row')).toHaveLength(1);

    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await user.click(within(screen.getByRole('region', { name: 'OEs' })).getByRole('button', { name: 'Download CSV' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    const csv = paramsOf(fetchMock, '/api/reports/analytics').find((p) => p.get('format') === 'csv');
    expect(csv?.get('table')).toBe('oes');
    click.mockRestore();
  });

  it('sends the region filter and hides the OE filter for an OE', async () => {
    const { fetchMock, user } = renderAt('/reports/analytics', 'OE');
    await screen.findByTestId('kpi-reopen-rate');
    expect(screen.queryByRole('combobox', { name: 'Filter by OE' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Filter by region' }));
    await user.click(await screen.findByRole('option', { name: 'South' }));
    await waitFor(() => expect(paramsOf(fetchMock, '/api/reports/analytics').some((p) => p.get('regionId') === 'rg-south')).toBe(true));
  });

  it('shows an error state with retry', async () => {
    renderAt('/reports/analytics', 'OM', {
      'GET /api/reports/analytics': () => new Response(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Boom' } }), { status: 500 }),
    });
    expect(await screen.findByRole('button', { name: /retry|try again/i })).toBeInTheDocument();
  });
});
