import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import type { Role } from '@champ/shared';
import { Toaster } from '@/components/ui/sonner';
import { AuthContext, type AuthContextValue } from '@/lib/auth';
import { makeUser, mockApi } from '@/test/fixtures';
import { App } from './App';

function renderAt(path: string, role: Role) {
  mockApi({ 'GET /api/masters/lookup/final-issue': { items: [] } });
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
