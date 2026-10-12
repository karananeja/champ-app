import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOARD_STATUSES, type BoardCard, type BoardResponse, type FitmentStatus } from '@champ/shared';
import { Toaster } from '@/components/ui/sonner';
import { AuthContext, type AuthContextValue } from '@/lib/auth';
import { callsTo, json, makeUser, mockApi } from '@/test/fixtures';
import { BoardPage } from './board-page';

const om = makeUser({ id: 'om-1', role: 'OM', name: 'Maya Manager' });

let n = 0;
function card(status: FitmentStatus, overrides: Partial<BoardCard> = {}): BoardCard {
  n += 1;
  return {
    id: `fit-${n}`,
    tkId: `TK-${String(n).padStart(5, '0')}`,
    status,
    task: { id: `task-${n}`, omId: `OM-${String(n).padStart(5, '0')}`, oeTaskId: `OE-${String(n).padStart(5, '0')}` },
    client: { id: 'cl-1', name: 'Zoomcar' },
    city: 'Bengaluru',
    activity: { id: 'act-1', name: 'New installation' },
    technician: status === 'OPEN' ? null : { id: 'ot-1', name: 'Ravi Kumar' },
    fitmentAt: `2026-10-${String(10 + n).padStart(2, '0')}T05:00:00.000Z`,
    reopenCount: 0,
    billable: null,
    replacementOf: null,
    updatedAt: '2026-10-12T00:00:00.000Z',
    ...overrides,
  };
}

function boardOf(cards: BoardCard[], counts: Partial<Record<FitmentStatus, number>> = {}): BoardResponse {
  const columns = Object.fromEntries(
    BOARD_STATUSES.map((s) => {
      const items = cards.filter((c) => c.status === s);
      const count = counts[s] ?? items.length;
      return [s, { count, items, hasMore: count > items.length }];
    }),
  ) as BoardResponse['columns'];
  return { columns };
}

function setViewport(desktop: boolean) {
  window.matchMedia = (query: string) =>
    ({
      matches: desktop && query.includes('min-width: 768px'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.search}</div>;
}

function renderBoard(board: BoardResponse, extra: Record<string, unknown> = {}, url = '/tasks/board') {
  const fetchMock = mockApi({
    'GET /api/board': board,
    'GET /api/tasks/options': {
      oes: [{ id: 'oe-1', name: 'Esha Exec' }],
      technicians: [
        { id: 'ot-1', name: 'Ravi Kumar', technicianType: 'PAYROLL', baseLocation: 'Bengaluru' },
        { id: 'ot-2', name: 'Suresh Rao', technicianType: 'PAYROLL', baseLocation: 'Pune' },
      ],
    },
    ...extra,
  });
  const auth: AuthContextValue = {
    status: 'authenticated',
    user: om,
    login: vi.fn(),
    loginWithGoogle: vi.fn(),
    startSession: vi.fn(),
    logout: vi.fn(),
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/tasks/board" element={<BoardPage />} />
          </Routes>
          <LocationProbe />
          <Toaster />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return fetchMock;
}

const column = (status: FitmentStatus) => screen.getAllByTestId('board-column').find((el) => el.dataset.status === status)!;
const handle = (tkId: string) => screen.getByRole('button', { name: new RegExp(`^${tkId},`) });

/** Picks a card up with Space, moves it `steps` columns with the arrows (negative = left) and leaves it held. */
async function pickUp(user: ReturnType<typeof userEvent.setup>, tkId: string, steps: number) {
  handle(tkId).focus();
  await user.keyboard('[Space]');
  await act(() => new Promise((r) => setTimeout(r, 0))); // the sensor listens from the next tick
  for (let i = 0; i < Math.abs(steps); i++) await user.keyboard(steps > 0 ? '[ArrowRight]' : '[ArrowLeft]');
}

beforeEach(() => {
  n = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('board (F07), desktop', () => {
  beforeEach(() => setViewport(true));

  it('renders the 6 main columns with counts and the collapsed side lanes; "Load more" when a column has more', async () => {
    const cards = [card('OPEN'), card('OPEN'), card('ASSIGNED'), card('OE_VERIFIED', { billable: true, reopenCount: 2 }), card('REOPENED')];
    renderBoard(boardOf(cards, { OPEN: 60 }));
    await screen.findByText('TK-00001');
    expect(screen.getAllByTestId('board-column').map((c) => [c.dataset.status, within(c).getByTestId('column-count').textContent])).toEqual([
      ['OPEN', '60'],
      ['ASSIGNED', '1'],
      ['IN_PROGRESS', '0'],
      ['SUBMITTED', '0'],
      ['OE_VERIFIED', '1'],
      ['OM_APPROVED', '0'],
      ['REOPENED', '1'],
      ['CLOSED_NOT_DONE', '0'],
      ['MOVED_TO_FT', '0'],
    ]);
    // Side lanes are collapsed: their cards aren't shown until "Other" is opened.
    expect(screen.queryByText('TK-00005')).not.toBeInTheDocument();
    expect(within(column('OPEN')).getByRole('button', { name: 'Load more' })).toBeInTheDocument();
    expect(within(column('ASSIGNED')).queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    expect(within(column('IN_PROGRESS')).getByText('Nothing here')).toBeInTheDocument();
    const verified = within(column('OE_VERIFIED'));
    expect(verified.getByTestId('reopen-chip')).toHaveTextContent('Reopened ×2');
    expect(verified.getByTestId('billable-badge')).toHaveTextContent('Billable: Yes');
    expect(within(column('OPEN')).getAllByTestId('board-card-technician')[0]).toHaveTextContent('Unassigned');
    expect(screen.getByTestId('finished-note')).toHaveTextContent('Finished columns show the last 7 days');

    await userEvent.setup().click(screen.getByRole('button', { name: /^Other/ }));
    expect(await screen.findByText('TK-00005')).toBeInTheDocument();
  });

  it('greys out the columns a dragged card cannot go to, and an Open → Assigned drop asks for the technician', async () => {
    const user = userEvent.setup();
    const cards = [card('OPEN'), card('ASSIGNED')];
    const fetchMock = renderBoard(boardOf(cards), { 'POST /api/tasks/task-1/assign': {} });
    await screen.findByText('TK-00001');
    await pickUp(user, 'TK-00001', 1);
    await waitFor(() => expect(column('IN_PROGRESS')).toHaveAttribute('aria-disabled', 'true'));
    const disabled = screen.getAllByTestId('board-column').filter((c) => c.getAttribute('aria-disabled') === 'true').map((c) => c.dataset.status);
    expect(disabled).toEqual(['IN_PROGRESS', 'SUBMITTED', 'OE_VERIFIED', 'OM_APPROVED', 'REOPENED', 'CLOSED_NOT_DONE', 'MOVED_TO_FT']);
    expect(column('OPEN')).not.toHaveAttribute('aria-disabled');
    expect(column('ASSIGNED')).not.toHaveAttribute('aria-disabled');
    expect(screen.getByTestId('drag-overlay')).toHaveTextContent('TK-00001');
    await user.keyboard('[Space]');

    const dialog = await screen.findByRole('dialog', { name: 'Assign TK-00001' });
    expect(screen.queryAllByTestId('board-column').filter((c) => c.getAttribute('aria-disabled'))).toHaveLength(0);
    await user.click(within(dialog).getByRole('combobox', { name: 'Technician' }));
    await user.click(await screen.findByRole('option', { name: /Suresh Rao/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/api/tasks/task-1/assign')).toEqual([{ fitmentIds: ['fit-1'], technicianId: 'ot-2' }]));
    expect(await screen.findByText('Assigned TK-00001 to Suresh Rao')).toBeInTheDocument();
  });

  it('a refused drop shows the reason and the card stays in its column', async () => {
    const user = userEvent.setup();
    const fetchMock = renderBoard(boardOf([card('ASSIGNED')]));
    await screen.findByText('TK-00001');
    await pickUp(user, 'TK-00001', 2); // Assigned → In progress → Submitted
    await user.keyboard('[Space]');
    expect(await screen.findByText('Only the technician can start or submit work')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(column('ASSIGNED')).getByText('TK-00001')).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  });

  it('Assigned → Open confirms the unassign; OE verified → Reopened asks for the reason', async () => {
    const user = userEvent.setup();
    const fetchMock = renderBoard(boardOf([card('ASSIGNED'), card('OE_VERIFIED')]), {
      'POST /api/tasks/task-1/assign': {},
      'POST /api/fitments/fit-2/transitions': {},
    });
    await screen.findByText('TK-00001');
    await pickUp(user, 'TK-00001', -1);
    await user.keyboard('[Space]');
    const confirm = await screen.findByRole('alertdialog', { name: 'Unassign TK-00001?' });
    await user.click(within(confirm).getByRole('button', { name: 'Unassign' }));
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/api/tasks/task-1/assign')).toEqual([{ fitmentIds: ['fit-1'], technicianId: null }]));

    await pickUp(user, 'TK-00002', 2); // OE verified → OM approved → Reopened
    await user.keyboard('[Space]');
    const dialog = await screen.findByRole('dialog', { name: 'Reopen TK-00002?' });
    await user.type(within(dialog).getByLabelText('Reason for reopening'), 'Photos are blurry');
    await user.click(within(dialog).getByRole('button', { name: 'Reopen' }));
    await waitFor(() =>
      expect(callsTo(fetchMock, 'POST', '/api/fitments/fit-2/transitions')).toEqual([{ action: 'REOPEN', payload: { reason: 'Photos are blurry' } }]),
    );
  });

  it('multi-select: dragging one of two selected OE-verified cards to OM approved bulk-approves both (optimistic)', async () => {
    const user = userEvent.setup();
    let resolve: (r: Response) => void = () => {};
    const fetchMock = renderBoard(boardOf([card('OE_VERIFIED'), card('OE_VERIFIED'), card('OE_VERIFIED')]), {
      'POST /api/fitments/approve': () => new Promise<Response>((r) => (resolve = r)),
    });
    await screen.findByText('TK-00001');
    await user.click(screen.getByRole('checkbox', { name: 'Select TK-00001' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select TK-00002' }));
    expect(screen.getByTestId('board-selection')).toHaveTextContent('2 selected in OE verified');
    await pickUp(user, 'TK-00002', 1);
    expect(screen.getByTestId('drag-overlay')).toHaveTextContent('2 fitments');
    await user.keyboard('[Space]');
    const confirm = await screen.findByRole('alertdialog', { name: 'Final approve 2 fitments?' });
    await user.click(within(confirm).getByRole('button', { name: 'Final approve' }));
    // Optimistic: the cards move before the server answers.
    await waitFor(() => expect(within(column('OM_APPROVED')).getByText('TK-00001')).toBeInTheDocument());
    expect(within(column('OM_APPROVED')).getByTestId('column-count')).toHaveTextContent('2');
    expect(within(column('OE_VERIFIED')).getByTestId('column-count')).toHaveTextContent('1');
    expect(callsTo(fetchMock, 'POST', '/api/fitments/approve')).toEqual([{ fitmentIds: ['fit-1', 'fit-2'] }]);
    resolve(json({ approved: ['fit-1', 'fit-2'], failed: [] }));
    expect(await screen.findByText('Final-approved 2 fitments')).toBeInTheDocument();
  });

  it('rolls back and lists the failed TK ids when the bulk approve fails', async () => {
    const user = userEvent.setup();
    renderBoard(boardOf([card('OE_VERIFIED'), card('OE_VERIFIED')]), {
      'POST /api/fitments/approve': {
        approved: [],
        failed: [{ tkId: 'TK-00002', code: 'INVALID_TRANSITION', message: 'This fitment is Reopened; only OE-verified fitments can be final-approved' }],
      },
    });
    await screen.findByText('TK-00001');
    await user.click(screen.getByRole('checkbox', { name: 'Select TK-00001' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select TK-00002' }));
    await pickUp(user, 'TK-00001', 1);
    await user.keyboard('[Space]');
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Final approve' }));
    expect(await screen.findByText(/Could not approve TK-00002 \(This fitment is Reopened/)).toBeInTheDocument();
    await waitFor(() => expect(within(column('OE_VERIFIED')).getByText('TK-00002')).toBeInTheDocument());
  });

  it('Shift-click selects a range in the same column; a card in another column starts a new selection', async () => {
    const user = userEvent.setup();
    renderBoard(boardOf([card('OPEN'), card('OPEN'), card('OPEN'), card('OPEN'), card('ASSIGNED')]));
    await screen.findByText('TK-00001');
    await user.click(screen.getByRole('checkbox', { name: 'Select TK-00001' }));
    await user.keyboard('{Shift>}');
    await user.click(screen.getByRole('checkbox', { name: 'Select TK-00003' }));
    await user.keyboard('{/Shift}');
    expect(screen.getByTestId('board-selection')).toHaveTextContent('3 selected in Open');
    expect(screen.getByRole('checkbox', { name: 'Select TK-00004' })).not.toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: 'Select TK-00005' }));
    expect(screen.getByTestId('board-selection')).toHaveTextContent('1 selected in Assigned');
  });
});

describe('board (F07), phones', () => {
  beforeEach(() => setViewport(false));

  it('"Move to…" lists only the allowed targets and opens the same dialogs', async () => {
    const user = userEvent.setup();
    renderBoard(boardOf([card('OE_VERIFIED'), card('IN_PROGRESS')]));
    await screen.findByText('TK-00001');
    expect(screen.getByRole('combobox', { name: 'Column' })).toHaveTextContent('Open (0)');
    await user.click(screen.getByRole('button', { name: 'Move TK-00001 to…' }));
    expect((await screen.findAllByRole('menuitem')).map((i) => i.textContent)).toEqual(['OM approved', 'Reopened']);
    await user.click(screen.getByRole('menuitem', { name: 'Reopened' }));
    expect(await screen.findByRole('dialog', { name: 'Reopen TK-00001?' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Move TK-00002 to…' }));
    const items = await screen.findAllByRole('menuitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('board filters', () => {
  beforeEach(() => setViewport(true));

  it('writes the filters to the URL and sends them to the API', async () => {
    const user = userEvent.setup();
    const fetchMock = renderBoard(boardOf([card('OPEN')]), {}, '/tasks/board?clientId=cl-1');
    await screen.findByText('TK-00001');
    expect(fetchMock.mock.calls.some(([url]) => (url as string).includes('clientId=cl-1'))).toBe(true);

    await user.click(screen.getByRole('combobox', { name: 'Filter by technician' }));
    await user.click(await screen.findByRole('option', { name: /Suresh Rao/ }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('clientId=cl-1&technicianId=ot-2'));

    await user.type(screen.getByRole('textbox', { name: 'Search by TK, OM or OE id' }), 'TK-12');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('q=TK-12'));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => /\/api\/board\?.*q=TK-12/.test(url as string))).toBe(true));

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(screen.getByTestId('location')).toBeEmptyDOMElement());
    expect(screen.getByRole('textbox', { name: 'Search by TK, OM or OE id' })).toHaveValue('');
  });

  it('opens the quick view with a link to the task', async () => {
    const user = userEvent.setup();
    const { makeFitment, makeTask } = await import('@/test/fixtures');
    const c = card('OE_VERIFIED');
    renderBoard(boardOf([c]), {
      'GET /api/tasks/task-1': makeTask({
        id: 'task-1',
        fitments: [makeFitment({ id: 'fit-1', status: 'OE_VERIFIED', availableActions: ['APPROVE', 'REOPEN'] })],
      }),
    });
    await user.click(await screen.findByRole('button', { name: /^TK-00001,/ }));
    const sheet = await screen.findByTestId('board-quick-view');
    expect(within(sheet).getByRole('link', { name: /Open task OM-00001/ })).toHaveAttribute('href', '/tasks/task-1');
    expect(await within(sheet).findByRole('button', { name: /Final approve/ })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: /Reopen/ })).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: /Change technician/ })).not.toBeInTheDocument();
  });
});
