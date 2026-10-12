import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TravelOptionsResponse, UserDto } from '@champ/shared';
import { Toaster } from '@/components/ui/sonner';
import { AuthContext, type AuthContextValue } from '@/lib/auth';
import { istToday } from '@/lib/dates';
import { callsTo, json, lookupsFixture, makeTravelTask, makeUser, mockApi } from '@/test/fixtures';
import { TravelFormDialog, type TravelFormMode } from './travel-form-dialog';

// F08: the raise / edit dialog.
const LOOKUPS = { ...lookupsFixture, clients: [{ id: 'cl-1', name: 'Zoomcar', code: 'ZOOM', contactName: 'P', contactPhone: '1', contactEmail: null, sites: [] }] };
const oneTech: TravelOptionsResponse = { technicians: [{ id: 'ot-1', name: 'Arjun Tech', technicianType: 'PAYROLL', baseLocation: 'Bengaluru' }] };
const twoTechs: TravelOptionsResponse = {
  technicians: [...oneTech.technicians, { id: 'ot-2', name: 'Bhavna Tech', technicianType: 'THIRD_PARTY', baseLocation: 'Pune' }],
};

function renderDialog(actor: UserDto, options: TravelOptionsResponse, mode: TravelFormMode = { kind: 'create' }, routes: Record<string, unknown> = {}) {
  const fetchMock = mockApi({
    'GET /api/lookups': LOOKUPS,
    'GET /api/travel-tasks/options': options,
    'POST /api/travel-tasks': (_url: string, init: RequestInit) => makeTravelTask({ ...JSON.parse(init.body as string), technician: { id: 'ot-1', name: 'Arjun Tech', technicianType: 'PAYROLL' } }),
    ...routes,
  });
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const auth: AuthContextValue = { status: 'authenticated', user: actor, login: vi.fn(), loginWithGoogle: vi.fn(), startSession: vi.fn(), logout: vi.fn() };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter>
          <TravelFormDialog mode={mode} onClose={onClose} onSaved={onSaved} />
          <Toaster />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return { fetchMock, onClose, onSaved };
}

const oe = makeUser({ id: 'oe-1', role: 'OE', name: 'Esha Exec' });
const om = makeUser({ id: 'om-1', role: 'OM', name: 'Maya Manager' });
const dialog = () => within(screen.getByTestId('travel-form'));

async function pick(user: ReturnType<typeof userEvent.setup>, label: RegExp, option: string) {
  await user.click(dialog().getByRole('combobox', { name: label }));
  await user.click(await screen.findByRole('option', { name: new RegExp(`^${option}`) }));
}

describe('TravelFormDialog (raise)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('validates the required fields before sending anything', async () => {
    const user = userEvent.setup();
    const { fetchMock } = renderDialog(om, twoTechs);
    await screen.findByRole('heading', { name: 'Raise travel task' });
    await user.click(dialog().getByRole('button', { name: 'Raise travel task' }));
    expect(await dialog().findByText('Choose a technician')).toBeInTheDocument();
    expect(dialog().getByText('Choose a location')).toBeInTheDocument();
    expect(dialog().getByText('Describe the purpose of travel (at least 3 characters)')).toBeInTheDocument();
    await user.type(dialog().getByLabelText(/^Distance/), '6000');
    await user.click(dialog().getByRole('button', { name: 'Raise travel task' }));
    expect(await dialog().findByText('The distance must be at most 5,000 km')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', '/api/travel-tasks')).toEqual([]);
  });

  it('disables future travel dates in the picker', async () => {
    const user = userEvent.setup();
    renderDialog(om, twoTechs);
    await user.click(await screen.findByRole('button', { name: /^Travel date/ }));
    const grid = screen.getByRole('grid');
    const [y, m, d] = istToday().split('-').map(Number) as [number, number, number];
    const month = grid.getAttribute('aria-label')!.split(' ')[0]!;
    expect(within(grid).getByRole('button', { name: new RegExp(`${month} ${d}(st|nd|rd|th), ${y}`) })).toBeEnabled();
    // The next month is entirely in the future.
    await user.click(screen.getByRole('button', { name: 'Go to the Next Month' }));
    const next = screen.getByRole('grid');
    const days = within(next)
      .getAllByRole('button')
      .filter((b) => /\d{4}/.test(b.getAttribute('aria-label') ?? ''));
    expect(days.length).toBeGreaterThan(27);
    expect(days.filter((b) => !(b as HTMLButtonElement).disabled)).toEqual([]);
    expect(m).toBeGreaterThan(0);
  });

  it('an OE with one technician: the technician is preset and hidden, the location follows the base city', async () => {
    const user = userEvent.setup();
    const { fetchMock, onSaved, onClose } = renderDialog(oe, oneTech);
    expect(await screen.findByTestId('technician-preset')).toHaveTextContent('Arjun Tech');
    expect(dialog().queryByRole('combobox', { name: /^Technician/ })).not.toBeInTheDocument();
    await pick(user, /^Location/, 'Bengaluru');
    await pick(user, /^Customer/, 'Zoomcar');
    await user.type(dialog().getByLabelText('Purpose of travel'), 'Picked up a faulty device');
    await user.type(dialog().getByLabelText(/^Distance/), '12.5');
    await user.click(dialog().getByRole('button', { name: 'Raise travel task' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(callsTo(fetchMock, 'POST', '/api/travel-tasks')).toEqual([
      {
        technicianId: 'ot-1',
        locationId: 'loc-blr',
        clientId: 'cl-1',
        purpose: 'Picked up a faulty device',
        travelDate: istToday(),
        relatedFitmentId: null,
        distanceKm: 12.5,
      },
    ]);
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ ttId: 'TT-00001' }));
    expect(await screen.findByText('TT-00001 raised')).toBeInTheDocument();
  });

  it('an OM chooses among technicians; picking one fills the location from their base city', async () => {
    const user = userEvent.setup();
    renderDialog(om, twoTechs);
    await pick(user, /^Technician/, 'Bhavna Tech');
    expect(dialog().getByRole('combobox', { name: /^Location/ })).toHaveTextContent('Pune');
  });

  it('checks receipts in the browser: images or PDF only', async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderDialog(om, twoTechs);
    const input = await screen.findByLabelText('Add receipts');
    await user.upload(input, new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    expect(screen.getByTestId('receipt-error')).toHaveTextContent('notes.txt: Only JPEG, PNG or WebP images or PDF files can be uploaded');
    await user.upload(input, new File(['%PDF-1.4'], 'bill.pdf', { type: 'application/pdf' }));
    expect(screen.getByTestId('pending-receipt')).toHaveTextContent('bill.pdf');
    await user.click(screen.getByRole('button', { name: 'Remove bill.pdf' }));
    expect(screen.queryByTestId('pending-receipt')).not.toBeInTheDocument();
  });

  it('shows a server refusal verbatim and keeps the dialog open', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog(oe, oneTech, { kind: 'create' }, {
      'POST /api/travel-tasks': json({ error: { code: 'FORBIDDEN', message: 'An operation executive can only raise travel tasks for their own technicians' } }, 403),
    });
    await screen.findByTestId('technician-preset');
    await pick(user, /^Location/, 'Pune');
    await user.type(dialog().getByLabelText('Purpose of travel'), 'Bus to the depot');
    await user.click(dialog().getByRole('button', { name: 'Raise travel task' }));
    expect(await dialog().findByRole('alert')).toHaveTextContent('An operation executive can only raise travel tasks for their own technicians');
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('TravelFormDialog (resubmit)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('prefills the TT and sends RESUBMIT with the changes', async () => {
    const user = userEvent.setup();
    const tt = makeTravelTask({ status: 'REJECTED', availableActions: ['RESUBMIT'] });
    const { fetchMock } = renderDialog(oe, oneTech, { kind: 'resubmit', tt }, {
      'POST /api/travel-tasks/tt-1/transitions': makeTravelTask({ status: 'RAISED' }),
    });
    expect(await screen.findByRole('heading', { name: 'Resubmit TT-00001' })).toBeInTheDocument();
    expect(dialog().getByLabelText('Purpose of travel')).toHaveValue('Picked up a faulty device');
    const distance = dialog().getByLabelText(/^Distance/);
    await user.clear(distance);
    await user.type(distance, '38');
    await user.click(dialog().getByRole('button', { name: 'Resubmit' }));
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/api/travel-tasks/tt-1/transitions')).toHaveLength(1));
    expect(callsTo(fetchMock, 'POST', '/api/travel-tasks/tt-1/transitions')[0]).toEqual({
      action: 'RESUBMIT',
      changes: {
        technicianId: 'ot-1',
        locationId: 'loc-blr',
        clientId: 'cl-1',
        purpose: 'Picked up a faulty device',
        travelDate: '2026-10-10',
        relatedFitmentId: null,
        distanceKm: 38,
      },
    });
  });
});
