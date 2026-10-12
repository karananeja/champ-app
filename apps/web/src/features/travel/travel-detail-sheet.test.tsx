import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TravelTaskDto, UserDto } from '@champ/shared';
import { Toaster } from '@/components/ui/sonner';
import { AuthContext, type AuthContextValue } from '@/lib/auth';
import { callsTo, json, makeTravelTask, makeUser, mockApi } from '@/test/fixtures';
import { TravelDetailSheet } from './travel-detail-sheet';

// F08: the detail sheet: fields, receipts, history and the actions the server allows.
function renderSheet(actor: UserDto, tt: TravelTaskDto, routes: Record<string, unknown> = {}) {
  const fetchMock = mockApi({
    'GET /api/travel-tasks/tt-1': tt,
    'GET /api/travel-tasks/options': { technicians: [] },
    'POST /api/travel-tasks/tt-1/transitions': (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { action: string };
      return makeTravelTask({ status: body.action === 'REJECT' ? 'REJECTED' : body.action === 'VERIFY' ? 'VERIFIED' : 'RAISED' });
    },
    ...routes,
  });
  const auth: AuthContextValue = { status: 'authenticated', user: actor, login: vi.fn(), loginWithGoogle: vi.fn(), startSession: vi.fn(), logout: vi.fn() };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter>
          <TravelDetailSheet id="tt-1" onClose={vi.fn()} />
          <Toaster />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return fetchMock;
}

const oe = makeUser({ id: 'oe-1', role: 'OE', name: 'Esha Exec' });
const om = makeUser({ id: 'om-1', role: 'OM', name: 'Maya Manager' });
const ro = makeUser({ id: 'ro-1', role: 'RO', name: 'Rhea Reader' });
const sheet = () => within(screen.getByTestId('travel-detail'));

describe('TravelDetailSheet', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows every field and the buttons from the flags (OE, Raised: Verify, Reject, Edit)', async () => {
    renderSheet(oe, makeTravelTask({ relatedFitment: { id: 'fit-1', tkId: 'TK-00012', taskId: 'task-1', omId: 'OM-00003', client: 'Zoomcar' } }));
    expect(await sheet().findByRole('heading', { name: 'TT-00001' })).toBeInTheDocument();
    expect(sheet().getByTestId('travel-status')).toHaveTextContent('Raised');
    expect(sheet().getByText('Picked up a faulty device')).toBeInTheDocument();
    expect(sheet().getByText('42.5 km')).toBeInTheDocument();
    expect(sheet().getByRole('link', { name: 'TK-00012' })).toHaveAttribute('href', '/tasks/task-1');
    const actions = within(sheet().getByTestId('travel-actions'));
    expect(actions.getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['Verify', 'Reject', 'Edit']);
  });

  it('RO: read-only (no actions, no receipt upload)', async () => {
    renderSheet(ro, makeTravelTask({ canEdit: false, canVerify: false, canManageAttachments: false, availableActions: [] }));
    expect(await sheet().findByRole('heading', { name: 'TT-00001' })).toBeInTheDocument();
    expect(sheet().queryByTestId('travel-actions')).not.toBeInTheDocument();
    expect(sheet().queryByText('Add receipts')).not.toBeInTheDocument();
  });

  it('Verify asks for confirmation, then sends VERIFY', async () => {
    const user = userEvent.setup();
    const fetchMock = renderSheet(oe, makeTravelTask());
    await user.click(await sheet().findByRole('button', { name: 'Verify' }));
    const dialog = await screen.findByRole('dialog', { name: 'Verify TT-00001?' });
    await user.click(within(dialog).getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/api/travel-tasks/tt-1/transitions')).toEqual([{ action: 'VERIFY' }]));
    expect(await screen.findByText('TT-00001 verified')).toBeInTheDocument();
  });

  it('Reject needs a reason (3+ characters) and shows server refusals verbatim', async () => {
    const user = userEvent.setup();
    const fetchMock = renderSheet(oe, makeTravelTask(), {
      'POST /api/travel-tasks/tt-1/transitions': json({ error: { code: 'INVALID_TRANSITION', message: 'TT-00001 is Verified; only Raised travel tasks can be rejected' } }, 409),
    });
    await user.click(await sheet().findByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reject TT-00001?' });
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Give a reason (at least 3 characters)');
    expect(callsTo(fetchMock, 'POST', '/api/travel-tasks/tt-1/transitions')).toEqual([]);
    await user.type(within(dialog).getByLabelText('Reason for rejecting'), 'Receipt missing');
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(await within(dialog).findByText('TT-00001 is Verified; only Raised travel tasks can be rejected')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', '/api/travel-tasks/tt-1/transitions')).toEqual([{ action: 'REJECT', reason: 'Receipt missing' }]);
  });

  it('OM on a verified TT: Reopen with a reason', async () => {
    const user = userEvent.setup();
    const fetchMock = renderSheet(
      om,
      makeTravelTask({ status: 'VERIFIED', canEdit: false, availableActions: ['REOPEN'], verifiedAt: '2026-10-11T05:30:00.000Z', verifiedBy: { id: 'oe-1', name: 'Esha Exec' } }),
    );
    const actions = within(await sheet().findByTestId('travel-actions'));
    expect(actions.getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['Reopen']);
    await user.click(actions.getByRole('button', { name: 'Reopen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reopen TT-00001?' });
    await user.type(within(dialog).getByLabelText('Reason for reopening'), 'Wrong distance');
    await user.click(within(dialog).getByRole('button', { name: 'Reopen' }));
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/api/travel-tasks/tt-1/transitions')).toEqual([{ action: 'REOPEN', reason: 'Wrong distance' }]));
  });

  it('Rejected: shows the reason; Resubmit opens the edit form titled Resubmit', async () => {
    const user = userEvent.setup();
    renderSheet(
      oe,
      makeTravelTask({ status: 'REJECTED', availableActions: ['RESUBMIT'], rejectionReason: 'Receipt missing', rejectedBy: { id: 'oe-1', name: 'Esha Exec' }, rejectedAt: '2026-10-11T05:30:00.000Z' }),
    );
    expect(await sheet().findByTestId('rejection')).toHaveTextContent('Receipt missing');
    const actions = within(sheet().getByTestId('travel-actions'));
    expect(actions.getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['Resubmit']);
    await user.click(actions.getByRole('button', { name: 'Resubmit' }));
    expect(await screen.findByRole('heading', { name: 'Resubmit TT-00001' })).toBeInTheDocument();
  });

  it('receipts: images open the viewer, PDFs are file chips opening in a new tab; history shows reasons and diffs', async () => {
    const attachment = (id: string, contentType: string, originalName: string) => ({
      id,
      status: 'ACTIVE' as const,
      url: `http://storage.test/travel/tt-1/${id}?expires=600`,
      contentType,
      sizeBytes: 1000,
      width: contentType === 'application/pdf' ? null : 800,
      height: contentType === 'application/pdf' ? null : 600,
      originalName,
      uploadedBy: { id: 'oe-1', name: 'Esha Exec' },
      createdAt: '2026-10-10T05:30:00.000Z',
    });
    renderSheet(
      oe,
      makeTravelTask({
        attachmentCount: 2,
        attachments: [attachment('a-1', 'image/jpeg', 'ticket.jpg'), attachment('a-2', 'application/pdf', 'bill.pdf')],
        events: [
          ...makeTravelTask().events,
          { id: 'ev-2', at: '2026-10-11T05:30:00.000Z', actor: { id: 'oe-1', name: 'Esha Exec' }, type: 'TT_REJECTED', fromStatus: 'RAISED', toStatus: 'REJECTED', data: { ttId: 'TT-00001', reason: 'Receipt missing' } },
          { id: 'ev-3', at: '2026-10-11T06:30:00.000Z', actor: { id: 'oe-1', name: 'Esha Exec' }, type: 'TT_RESUBMITTED', fromStatus: 'REJECTED', toStatus: 'RAISED', data: { ttId: 'TT-00001', distanceKm: [42.5, 38] } },
        ],
      }),
    );
    expect(await sheet().findByRole('heading', { name: 'Receipts (2)' })).toBeInTheDocument();
    const chip = within(sheet().getByTestId('receipt-pdf')).getByRole('link', { name: /bill\.pdf/ });
    expect(chip).toHaveAttribute('href', 'http://storage.test/travel/tt-1/a-2?expires=600');
    expect(chip).toHaveAttribute('target', '_blank');
    expect(sheet().getByRole('button', { name: 'Open ticket.jpg' })).toBeInTheDocument();
    expect(sheet().getByRole('button', { name: 'Remove bill.pdf' })).toBeInTheDocument();
    const history = within(sheet().getByTestId('travel-history'));
    expect(history.getAllByTestId('travel-event').map((e) => e.querySelector('span.font-medium')?.textContent)).toEqual(['Raised', 'Rejected', 'Resubmitted']);
    expect(history.getByText('Reason: Receipt missing')).toBeInTheDocument();
    expect(history.getByText('Distance (km): 42.5 → 38')).toBeInTheDocument();
  });
});
