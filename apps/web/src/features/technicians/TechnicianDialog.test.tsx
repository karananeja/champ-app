import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CreateInviteResponse, TechnicianDto, UserDto } from '@champ/shared';
import { callsTo, makeUser, mockApi } from '@/test/fixtures';
import { TechnicianDialog } from './TechnicianDialog';

const om = makeUser({ id: 'om-1', role: 'OM', name: 'Maya Manager' });
const oe = makeUser({ id: 'oe-1', role: 'OE', name: 'Omar Executive', managerId: 'om-1' });

const created: CreateInviteResponse = {
  invite: {
    id: 'inv-1',
    email: 'ravi@example.com',
    role: 'OT',
    jobTitle: null,
    status: 'PENDING',
    manager: { id: 'oe-1', name: 'Omar Executive' },
    invitedBy: { id: 'om-1', name: 'Maya Manager' },
    name: 'Ravi Kumar',
    phone: '+91 90000 00001',
    technicianType: 'THIRD_PARTY',
    baseLocationId: 'loc-pune',
    expiresAt: '2026-10-14T00:00:00.000Z',
    usedAt: null,
    revokedAt: null,
    createdAt: '2026-10-11T00:00:00.000Z',
  },
  link: 'http://localhost:5173/accept-invite?token=tech-token',
};

function renderDialog(actor: UserDto, target: TechnicianDto | 'new') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <TechnicianDialog actor={actor} target={target} onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

async function fillCommonFields(user: ReturnType<typeof userEvent.setup>) {
  const dialog = screen.getByRole('dialog');
  await user.type(within(dialog).getByLabelText('Name'), 'Ravi Kumar');
  await user.type(within(dialog).getByLabelText('Contact number'), '+91 90000 00001');
  await user.type(within(dialog).getByLabelText('Email'), 'Ravi@Example.com');
  await user.click(within(dialog).getByRole('radio', { name: 'Third party' }));
  await user.click(within(dialog).getByRole('combobox', { name: 'Base location' }));
  await user.click(await screen.findByRole('option', { name: /Pune, Maharashtra/ }));
}

describe('TechnicianDialog — add', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('validates required fields without calling the API', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({ 'GET /api/users/managers': { items: [] } });
    renderDialog(om, 'new');
    await user.click(screen.getByRole('button', { name: 'Create invite' }));
    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid phone number')).toBeInTheDocument();
    expect(screen.getByText('Email is required')).toBeInTheDocument();
    expect(screen.getByText('Choose a technician type')).toBeInTheDocument();
    expect(screen.getByText('Choose a base location')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', '/api/technicians')).toHaveLength(0);
  });

  it('an OM picks the reporting OE; success shows the one-time invite link', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({
      'GET /api/users/managers': { items: [{ id: 'oe-1', name: 'Omar Executive' }] },
      'POST /api/technicians': created,
    });
    renderDialog(om, 'new');
    await fillCommonFields(user);

    // The reporting OE is required for an OM.
    await user.click(screen.getByRole('button', { name: 'Create invite' }));
    expect(await screen.findByText('Choose the reporting OE')).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: 'Reporting OE' }));
    await user.click(await screen.findByRole('option', { name: 'Omar Executive' }));
    await user.click(screen.getByRole('button', { name: 'Create invite' }));

    expect(await screen.findByText('Invite created')).toBeInTheDocument();
    expect(screen.getByText('This link is shown only once and expires in 72 hours')).toBeInTheDocument();
    expect(screen.getByLabelText('Invite link')).toHaveValue(created.link);
    expect(callsTo(fetchMock, 'POST', '/api/technicians')).toEqual([
      {
        name: 'Ravi Kumar',
        phone: '+91 90000 00001',
        email: 'ravi@example.com',
        technicianType: 'THIRD_PARTY',
        baseLocationId: 'loc-pune',
        managerId: 'oe-1',
      },
    ]);
  });

  it('an OE does not choose a manager: it is forced to themselves', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({ 'POST /api/technicians': created });
    renderDialog(oe, 'new');
    expect(screen.queryByRole('combobox', { name: 'Reporting OE' })).not.toBeInTheDocument();
    expect(screen.getByText(/Reports to:/)).toHaveTextContent('Omar Executive (you)');

    await fillCommonFields(user);
    await user.click(screen.getByRole('button', { name: 'Create invite' }));
    expect(await screen.findByText('Invite created')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', '/api/technicians')[0]).toMatchObject({ managerId: 'oe-1' });
    expect(callsTo(fetchMock, 'GET', '/api/users/managers')).toHaveLength(0);
  });

  it('shows a taken email next to the email field', async () => {
    const user = userEvent.setup();
    mockApi({
      'GET /api/users/managers': { items: [{ id: 'oe-1', name: 'Omar Executive' }] },
      'POST /api/technicians': () =>
        new Response(JSON.stringify({ error: { code: 'EMAIL_EXISTS', message: 'A user with this email already exists' } }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
    });
    renderDialog(oe, 'new');
    await fillCommonFields(user);
    await user.click(screen.getByRole('button', { name: 'Create invite' }));
    expect(await screen.findByText('A user with this email already exists')).toBeInTheDocument();
  });
});

describe('TechnicianDialog — edit', () => {
  afterEach(() => vi.unstubAllGlobals());

  const tech: TechnicianDto = {
    ...makeUser({
      id: 'ot-1',
      role: 'OT',
      name: 'Asha Tech',
      email: 'asha@example.com',
      phone: '+91 90000 00005',
      managerId: 'oe-1',
      technicianType: 'PAYROLL',
      baseLocationId: 'loc-old',
    }),
    baseLocation: { id: 'loc-old', city: 'Oldtown', state: 'Goa' },
  };

  it('prefills the technician, keeps an inactive base location visible, and PATCHes the changes', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({ 'PATCH /api/technicians/ot-1': { ...tech, technicianType: 'CONTRACTUAL' } });
    const { onOpenChange } = renderDialog(om, tech);

    expect(screen.getByText('Edit technician')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Asha Tech');
    expect(screen.getByRole('radio', { name: 'Payroll' })).toBeChecked();
    expect(screen.getByRole('combobox', { name: 'Base location' })).toHaveTextContent('Oldtown, Goa (inactive)');
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Contractual' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(callsTo(fetchMock, 'PATCH', '/api/technicians/ot-1')).toEqual([
      { name: 'Asha Tech', phone: '+91 90000 00005', technicianType: 'CONTRACTUAL', baseLocationId: 'loc-old' },
    ]);
  });
});
