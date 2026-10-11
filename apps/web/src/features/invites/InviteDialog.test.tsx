import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateInviteResponse, UserDto } from '@champ/shared';
import { callsTo, makeUser, mockApi } from '@/test/fixtures';
import { InviteDialog } from './InviteDialog';

const oe: UserDto = makeUser({
  id: 'oe-1',
  email: 'oe@intellicar.in',
  name: 'Omar Executive',
  role: 'OE',
  managerId: 'om-1',
  manager: { id: 'om-1', name: 'Maya', phone: null },
});

const response: CreateInviteResponse = {
  invite: {
    id: 'inv-1',
    email: 'tech@intellicar.in',
    role: 'OT',
    jobTitle: null,
    status: 'PENDING',
    manager: { id: oe.id, name: oe.name },
    invitedBy: { id: oe.id, name: oe.name },
    name: null,
    phone: null,
    technicianType: 'PAYROLL',
    baseLocationId: 'loc-blr',
    expiresAt: '2026-10-14T00:00:00.000Z',
    usedAt: null,
    revokedAt: null,
    createdAt: '2026-10-11T00:00:00.000Z',
  },
  link: 'http://localhost:5173/accept-invite?token=one-time-token',
};

function renderDialog(onOpenChange = vi.fn(), actor: UserDto = oe) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <InviteDialog actor={actor} open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

/** Fills the email and the OT fields (type and base location). */
async function fillTechnicianInvite(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Email'), 'tech@intellicar.in');
  await user.click(screen.getByRole('radio', { name: 'Payroll' }));
  await user.click(screen.getByRole('combobox', { name: 'Base location' }));
  await user.click(await screen.findByRole('option', { name: /Bengaluru, Karnataka/ }));
}

describe('InviteDialog', () => {
  let fetchMock: ReturnType<typeof mockApi>;

  beforeEach(() => {
    fetchMock = mockApi({ 'POST /api/invites': response });
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

    await fillTechnicianInvite(user);
    await user.click(screen.getByRole('button', { name: 'Create invite' }));

    expect(await screen.findByText('Invite created')).toBeInTheDocument();
    expect(screen.getByText('This link is shown only once and expires in 72 hours')).toBeInTheDocument();
    expect(screen.getByLabelText('Invite link')).toHaveValue(response.link);

    expect(callsTo(fetchMock, 'POST', '/api/invites')).toEqual([
      {
        email: 'tech@intellicar.in',
        role: 'OT',
        managerId: 'oe-1',
        technicianType: 'PAYROLL',
        baseLocationId: 'loc-blr',
      },
    ]);

    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith(response.link);
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('does not show the link again after the dialog is closed', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();

    await fillTechnicianInvite(user);
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
    expect(callsTo(fetchMock, 'POST', '/api/invites')).toHaveLength(0);
  });

  it('an OT invite shows and requires the technician type and base location', async () => {
    const user = userEvent.setup();
    renderDialog();
    expect(screen.getByRole('radiogroup', { name: 'Technician type' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Base location' })).toBeInTheDocument();

    await user.type(screen.getByLabelText('Email'), 'tech@intellicar.in');
    await user.click(screen.getByRole('button', { name: 'Create invite' }));
    expect(await screen.findByText('Choose a technician type')).toBeInTheDocument();
    expect(screen.getByText('Choose a base location')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', '/api/invites')).toHaveLength(0);
  });

  it('the technician fields are hidden for other roles', () => {
    renderDialog(vi.fn(), makeUser({ id: 'sa-1', role: 'SUPER_ADMIN', name: 'Sam Admin' }));
    expect(screen.getByRole('combobox', { name: 'Role' })).toHaveTextContent('Super Admin');
    expect(screen.queryByRole('radiogroup', { name: 'Technician type' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Base location' })).not.toBeInTheDocument();
  });
});
