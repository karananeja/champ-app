import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/lib/auth';
import { mockApi } from '@/test/fixtures';
import { AcceptInvitePage } from './accept-invite-page';

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

describe('AcceptInvitePage — invite errors (CR-03)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['INVITE_EXPIRED', 'This invite has expired'],
    ['INVITE_USED', 'This invite has already been used'],
    ['INVITE_INVALID', 'This invite link is not valid'],
  ])('%s shows the invite-error illustration, the reason and a way to sign in', async (code, title) => {
    mockApi({
      'GET /api/invites/lookup': () =>
        new Response(JSON.stringify({ error: { code, message: 'x' } }), { status: 410, headers: { 'Content-Type': 'application/json' } }),
      'GET /api/config': { googleClientId: null },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <AuthContext.Provider value={auth}>
          <MemoryRouter initialEntries={['/accept-invite?token=abc']}>
            <AcceptInvitePage />
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(title);
    expect(container.querySelectorAll('[data-illustration="invite-error"]').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/login');
  });

  it('the set-up form uses the welcome illustration', async () => {
    renderPage();
    expect(await screen.findByLabelText('Full name')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-illustration="welcome-aboard"]').length).toBe(2);
  });
});
