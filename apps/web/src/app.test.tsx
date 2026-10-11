import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import type { Role } from '@champ/shared';
import { Toaster } from '@/components/ui/sonner';
import { AuthContext, type AuthContextValue } from '@/lib/auth';
import { makeUser, mockApi } from '@/test/fixtures';
import { App } from './app';

function renderAt(path: string, role: Role, routes: Record<string, unknown> = {}) {
  mockApi({ 'GET /api/masters/lookup/final-issue': { items: [] }, ...routes });
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
          <Toaster />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

const sidebar = () => within(screen.getAllByRole('navigation', { name: 'Main' })[0]!);

describe('Masters route guard (CR-01)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  for (const role of ['OE', 'RO', 'OT'] as const) {
    for (const path of ['/masters', '/masters/final-issue']) {
      it(`${role} opening ${path} is sent to the dashboard with a message`, async () => {
        const toastError = vi.spyOn(toast, 'error');
        renderAt(path, role);
        expect(await screen.findByRole('heading', { name: 'Welcome, Test User' })).toBeInTheDocument();
        expect(await screen.findByText("You don't have access to that page")).toBeInTheDocument();
        expect(toastError).toHaveBeenCalledWith("You don't have access to that page", { id: 'no-access' });
        expect(sidebar().queryByRole('link', { name: 'All masters' })).not.toBeInTheDocument();
      });
    }
  }

  for (const role of ['SUPER_ADMIN', 'OM'] as const) {
    it(`${role} can open the masters pages`, async () => {
      // Sonner keeps toasts in a module-level store, so check the call rather than the DOM.
      const toastError = vi.spyOn(toast, 'error');
      renderAt('/masters/final-issue', role);
      expect(await screen.findByRole('heading', { name: 'Final issues' })).toBeInTheDocument();
      expect(sidebar().getByRole('link', { name: 'All masters' })).toBeInTheDocument();
      expect(toastError).not.toHaveBeenCalled();
    });
  }
});

describe('Tasks route guards (F04)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const cases: [string, Role][] = [
    ['/tasks', 'OT'],
    ['/tasks/new', 'RO'],
    ['/tasks/bulk', 'RO'],
    ['/tasks/assigned', 'OM'],
    ['/tasks/task-1/edit', 'RO'],
  ];
  for (const [path, role] of cases) {
    it(`${role} opening ${path} is sent to the dashboard`, async () => {
      const toastError = vi.spyOn(toast, 'error');
      renderAt(path, role);
      expect(await screen.findByRole('heading', { name: 'Welcome, Test User' })).toBeInTheDocument();
      expect(toastError).toHaveBeenCalledWith("You don't have access to that page", { id: 'no-access' });
    });
  }

  it('RO opens Open tasks and the placeholder pages', async () => {
    renderAt('/tasks', 'RO');
    expect(await screen.findByRole('heading', { name: 'Open tasks' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Create task' })).not.toBeInTheDocument();
    expect(sidebar().getByRole('link', { name: 'Travel tasks' })).toBeInTheDocument();
  });

  it('the travel placeholder says it is coming later', async () => {
    renderAt('/tasks/travel', 'OE');
    expect(await screen.findByRole('heading', { name: 'Travel tasks' })).toBeInTheDocument();
    expect(screen.getByText('Coming in a later release')).toBeInTheDocument();
  });

  it('F05: Faulty and Re-opened are real lists; Awaiting approval is for SA/OM only', async () => {
    renderAt('/tasks/faulty', 'OE', {
      'GET /api/fitments/faulty': { items: [], total: 0, page: 1, pageSize: 20 },
      'GET /api/tasks/options': { oes: [], technicians: [] },
    });
    expect(await screen.findByRole('heading', { name: 'Faulty tasks' })).toBeInTheDocument();
    expect(await screen.findByText('No fitment has been moved to FT.')).toBeInTheDocument();
    expect(screen.queryByText('Coming in a later release')).not.toBeInTheDocument();
    expect(sidebar().queryByRole('link', { name: 'Awaiting approval' })).not.toBeInTheDocument();
  });

  it('F05: an OE opening Awaiting approval is sent to the dashboard', async () => {
    const toastError = vi.spyOn(toast, 'error');
    renderAt('/tasks/awaiting-approval', 'OE');
    expect(await screen.findByRole('heading', { name: 'Welcome, Test User' })).toBeInTheDocument();
    expect(toastError).toHaveBeenCalledWith("You don't have access to that page", { id: 'no-access' });
  });
});
