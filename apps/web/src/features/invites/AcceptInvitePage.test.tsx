import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/lib/auth';
import { mockApi } from '@/test/fixtures';
import { AcceptInvitePage } from './AcceptInvitePage';

const auth: AuthContextValue = {
  status: 'anonymous',
  user: null,
  login: vi.fn(),
  loginWithGoogle: vi.fn(),
  startSession: vi.fn(),
  logout: vi.fn(),
};

function renderPage() {
  mockApi({
    'GET /api/invites/lookup': { email: 'new@intellicar.in', role: 'OE', inviterName: 'Maya', name: null, phone: null },
    'GET /api/config': { googleClientId: null },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={['/accept-invite?token=abc']}>
          <AcceptInvitePage />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

describe('AcceptInvitePage password fields', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('password and confirm password toggle independently', async () => {
    const user = userEvent.setup();
    renderPage();
    const password = await screen.findByLabelText('Password');
    const confirm = screen.getByLabelText('Confirm password');
    const [togglePassword, toggleConfirm] = screen.getAllByRole('button', { name: 'Show password' });
    expect(password).toHaveAttribute('type', 'password');
    expect(confirm).toHaveAttribute('type', 'password');

    await user.click(togglePassword!);
    expect(password).toHaveAttribute('type', 'text');
    expect(confirm).toHaveAttribute('type', 'password');
    expect(togglePassword).toHaveAttribute('aria-pressed', 'true');
    expect(toggleConfirm).toHaveAttribute('aria-pressed', 'false');

    await user.click(toggleConfirm!);
    expect(confirm).toHaveAttribute('type', 'text');
    await user.click(togglePassword!);
    expect(password).toHaveAttribute('type', 'password');
    expect(confirm).toHaveAttribute('type', 'text');
    expect(togglePassword).toHaveAccessibleName('Show password');
    expect(toggleConfirm).toHaveAccessibleName('Hide password');
  });
});
