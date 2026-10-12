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

  it('RO opens Open tasks and sees the Travel tab (CR-10)', async () => {
    renderAt('/tasks', 'RO');
    expect(await screen.findByRole('heading', { name: 'Open tasks' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Create task' })).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Task views' })).toHaveTextContent('Travel');
  });

  it('F08: Travel tasks is a real list (the placeholder is gone)', async () => {
    renderAt('/tasks/travel', 'OE', { 'GET /api/travel-tasks': { items: [], total: 0, page: 1, pageSize: 20 } });
    expect(await screen.findByRole('heading', { name: 'Travel tasks' })).toBeInTheDocument();
    expect(await screen.findByText('No travel tasks yet')).toBeInTheDocument();
    expect(screen.queryByText('Coming in a later release')).not.toBeInTheDocument();
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

describe('404, 403 and error pages (CR-03)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('an unknown URL shows the 404 page inside the app, with a way home', async () => {
    renderAt('/no/such/page', 'OM');
    const page = await screen.findByTestId('not-found-page');
    expect(within(page).getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(page).toHaveTextContent('/no/such/page');
    expect(page.querySelector('[data-illustration="not-found"]')).toHaveAttribute('aria-hidden', 'true');
    expect(within(page).getByRole('link', { name: 'Go to the dashboard' })).toHaveAttribute('href', '/');
    expect(sidebar().getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
  });

  const forbidden: [string, Role][] = [
    ['/users', 'OT'],
    ['/technicians', 'OT'],
    ['/clients', 'OT'],
    ['/clients/new', 'RO'],
    ['/clients/c-1/edit', 'OE'],
  ];
  for (const [path, role] of forbidden) {
    it(`${role} opening ${path} gets the 403 page (no redirect)`, async () => {
      renderAt(path, role);
      const page = await screen.findByTestId('forbidden-page');
      expect(within(page).getByRole('heading', { name: "You don't have access" })).toBeInTheDocument();
      expect(page.querySelector('[data-illustration="access-denied"]')).not.toBeNull();
    });
  }

  it('a page that throws shows the error page instead of a blank screen; navigating away recovers', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // A malformed API response makes the task page throw while rendering.
    renderAt('/tasks/t-1', 'OM', { 'GET /api/tasks/t-1': {} });
    const crash = await screen.findByTestId('crash-page');
    expect(within(crash).getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(crash.querySelector('[data-illustration="server-error"]')).not.toBeNull();
    sidebar().getByRole('link', { name: 'Profile' }).click();
    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument();
    expect(screen.queryByTestId('crash-page')).not.toBeInTheDocument();
  });
});

describe('Tasks page (CR-10)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const LIST = { items: [], total: 0, page: 1, pageSize: 20 };

  it('one Tasks menu item, active on a tab view; the tab bar marks the current view', async () => {
    renderAt('/tasks/faulty', 'OM', { 'GET /api/tasks/options': { oes: [], technicians: [] } });
    expect(await screen.findByRole('heading', { name: 'Faulty tasks', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tasks', level: 1 })).toBeInTheDocument();
    expect(sidebar().getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page');
    const tabs = within(screen.getByRole('navigation', { name: 'Task views' }));
    expect(tabs.getByRole('link', { name: 'Faulty' })).toHaveAttribute('aria-current', 'page');
    expect(tabs.getByRole('link', { name: 'Open' })).not.toHaveAttribute('aria-current');
    // Create task / Bulk upload only on the Open tab.
    expect(screen.queryByRole('link', { name: 'Create task' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Bulk upload' })).not.toBeInTheDocument();
  });

  it('creators get Create task and Bulk upload on the Open tab', async () => {
    renderAt('/tasks', 'OE', { 'GET /api/tasks': LIST, 'GET /api/tasks/options': { oes: [], technicians: [] } });
    expect(await screen.findByRole('heading', { name: 'Open tasks', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create task' })).toHaveAttribute('href', '/tasks/new');
    expect(screen.getByRole('link', { name: 'Bulk upload' })).toHaveAttribute('href', '/tasks/bulk');
    expect(within(screen.getByRole('navigation', { name: 'Task views' })).getByRole('link', { name: 'Open' })).toHaveAttribute('aria-current', 'page');
  });

  it('Create task and a task page have no tab bar but keep Tasks active in the menu', async () => {
    renderAt('/tasks/new', 'OM', { 'GET /api/tasks/options': { oes: [], technicians: [] }, 'GET /api/clients': LIST });
    await screen.findAllByRole('heading', { level: 1 });
    expect(screen.queryByRole('navigation', { name: 'Task views' })).not.toBeInTheDocument();
    expect(sidebar().getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page');
  });
});
