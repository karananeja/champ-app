import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DashboardSummaryDto, Role } from '@champ/shared';
import { AuthContext, type AuthContextValue } from '@/lib/auth';
import { makeUser, mockApi } from '@/test/fixtures';
import { DashboardPage } from './dashboard-page';
import { statCardsFor } from './stat-cards';

// CR-03: role-aware stat cards that link to their lists.

function renderDashboard(role: Role, summary: DashboardSummaryDto | (() => Response)) {
  const fetchMock = mockApi({ 'GET /api/tasks/summary': summary });
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
        <MemoryRouter>
          <DashboardPage />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return fetchMock;
}

const card = (key: string) => screen.getByTestId(`stat-${key}`);

describe('statCardsFor', () => {
  it('gives each role its cards, each linking to the list its count comes from', () => {
    const cards = (role: Role) => statCardsFor(role).map((c) => [c.key, c.to]);
    const manager = [
      ['openTasks', '/tasks'],
      ['awaitingApproval', '/tasks/awaiting-approval'],
      ['reopened', '/tasks/reopened'],
      ['faulty', '/tasks/faulty'],
      ['completedTasks', '/tasks/completed'],
    ];
    expect(cards('SUPER_ADMIN')).toEqual(manager);
    // F08: OM and OE also get "Travel to verify", linking to the Raised travel tasks.
    expect(cards('OM')).toEqual([manager[0], manager[1], ['travelToVerify', '/tasks/travel?status=RAISED'], ...manager.slice(2)]);
    expect(cards('OE')).toEqual([
      ['assignedToMe', '/tasks/assigned'],
      ['awaitingMyVerification', '/tasks/assigned'],
      ['travelToVerify', '/tasks/travel?status=RAISED'],
      ['openTasks', '/tasks'],
      ['reopened', '/tasks/reopened'],
      ['faulty', '/tasks/faulty'],
    ]);
    expect(cards('RO')).toEqual([
      ['openTasks', '/tasks'],
      ['completedTasks', '/tasks/completed'],
    ]);
    expect(cards('OT')).toEqual([]);
  });
});

describe('DashboardPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('OM: welcome with an illustration and the six cards with counts and links', async () => {
    renderDashboard('OM', { openTasks: 12, completedTasks: 30, awaitingApproval: 3, reopened: 2, faulty: 1, travelToVerify: 4 });
    expect(screen.getByRole('heading', { name: 'Welcome, Test User' })).toBeInTheDocument();
    expect(document.querySelector('[data-illustration="dashboard"]')).toHaveAttribute('aria-hidden', 'true');
    expect(await within(card('openTasks')).findByText('12')).toBeInTheDocument();
    expect(card('openTasks')).toHaveAttribute('href', '/tasks');
    expect(card('awaitingApproval')).toHaveTextContent('Awaiting approval3');
    expect(card('awaitingApproval')).toHaveAttribute('href', '/tasks/awaiting-approval');
    expect(card('reopened')).toHaveTextContent('2');
    expect(card('faulty')).toHaveTextContent('1');
    expect(card('completedTasks')).toHaveAttribute('href', '/tasks/completed');
    expect(card('travelToVerify')).toHaveTextContent('Travel to verify4');
    expect(card('travelToVerify')).toHaveAttribute('href', '/tasks/travel?status=RAISED');
    expect(screen.getAllByRole('link')).toHaveLength(6);
  });

  it('OE: own tasks and what waits for verification', async () => {
    renderDashboard('OE', { openTasks: 5, completedTasks: 1, reopened: 0, faulty: 0, assignedToMe: 4, awaitingMyVerification: 2, travelToVerify: 3 });
    expect(await within(card('assignedToMe')).findByText('4')).toBeInTheDocument();
    expect(card('awaitingMyVerification')).toHaveTextContent('To verify2');
    expect(card('travelToVerify')).toHaveTextContent('Travel to verify3');
    expect(screen.queryByTestId('stat-awaitingApproval')).not.toBeInTheDocument();
  });

  it('RO: open and completed only', async () => {
    renderDashboard('RO', { openTasks: 7, completedTasks: 9 });
    expect(await within(card('completedTasks')).findByText('9')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('OT: no cards and no summary request', () => {
    const fetchMock = renderDashboard('OT', { openTasks: 0, completedTasks: 0 });
    expect(screen.getByRole('heading', { name: 'Your work happens in the field app' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Summary' })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows skeletons while loading and an error state when the summary fails', async () => {
    renderDashboard('RO', () => new Response(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'x' } }), { status: 500 }));
    expect(screen.getByRole('list', { name: 'Summary' })).toHaveAttribute('aria-busy', 'true');
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
  });
});
