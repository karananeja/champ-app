import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateInviteResponse, UserDto } from '@champ/shared';
import { InviteDialog } from './InviteDialog';

const oe: UserDto = {
  id: 'oe-1',
  email: 'oe@intellicar.in',
  name: 'Omar Executive',
  phone: null,
  jobTitle: null,
  role: 'OE',
  status: 'ACTIVE',
  authProvider: 'PASSWORD',
  managerId: 'om-1',
  manager: { id: 'om-1', name: 'Maya', phone: null },
  canManageUsers: false,
  canManageTaskTypes: false,
  createdAt: '2026-10-11T00:00:00.000Z',
};

const response: CreateInviteResponse = {
  invite: {
    id: 'inv-1',
    email: 'tech@intellicar.in',
    role: 'OT',
    jobTitle: null,
    status: 'PENDING',
    manager: { id: oe.id, name: oe.name },
    invitedBy: { id: oe.id, name: oe.name },
    expiresAt: '2026-10-14T00:00:00.000Z',
    usedAt: null,
    revokedAt: null,
    createdAt: '2026-10-11T00:00:00.000Z',
  },
  link: 'http://localhost:5173/accept-invite?token=one-time-token',
};

function renderDialog(onOpenChange = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <InviteDialog actor={oe} open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

describe('InviteDialog', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response), { status: 201, headers: { 'Content-Type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('an OE can only invite an OT and is the forced manager', () => {
    renderDialog();
    expect(screen.getByRole('combobox', { name: 'Role' })).toHaveTextContent('Operations Technician');
    expect(screen.getByText(/Manager:/)).toHaveTextContent('Omar Executive (you)');
  });

  it('switches to a one-time link view with a copy button after creating the invite', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    renderDialog();

    await user.type(screen.getByLabelText('Email'), 'tech@intellicar.in');
    await user.click(screen.getByRole('button', { name: 'Create invite' }));

    expect(await screen.findByText('Invite created')).toBeInTheDocument();
    expect(screen.getByText('This link is shown only once and expires in 72 hours')).toBeInTheDocument();
    expect(screen.getByLabelText('Invite link')).toHaveValue(response.link);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/invites');
    expect(JSON.parse(init.body)).toEqual({ email: 'tech@intellicar.in', role: 'OT', managerId: 'oe-1' });

    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith(response.link);
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('does not show the link again after the dialog is closed', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();

    await user.type(screen.getByLabelText('Email'), 'tech@intellicar.in');
    await user.click(screen.getByRole('button', { name: 'Create invite' }));
    await screen.findByText('Invite created');

    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    // Still mounted with open=true (parent didn't close it), so the form is back instead of the link.
    await waitFor(() => expect(screen.queryByLabelText('Invite link')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Create invite' })).toBeInTheDocument();
  });

  it('shows validation errors without calling the API', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('button', { name: 'Create invite' }));
    expect(await screen.findByText('Email is required')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
