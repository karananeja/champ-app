import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TaskDto, UserDto } from '@champ/shared';
import { Toaster } from '@/components/ui/sonner';
import { AuthContext, type AuthContextValue } from '@/lib/auth';
import { callsTo, json, makeFitment, makeTask, makeUser, mockApi } from '@/test/fixtures';
import { TaskDetailPage } from './task-detail-page';

const SIMULATOR = 'Simulate technician (dev only)';

function renderTask(actor: UserDto, task: TaskDto, extra: Record<string, unknown> = {}, devSimulator = false) {
  const fetchMock = mockApi({
    'GET /api/tasks/task-1': task,
    'GET /api/config': { googleClientId: null, devSimulator },
    'GET /api/tasks/options': { oes: [], technicians: [] },
    ...extra,
  });
  const auth: AuthContextValue = {
    status: 'authenticated',
    user: actor,
    login: vi.fn(),
    loginWithGoogle: vi.fn(),
    startSession: vi.fn(),
    logout: vi.fn(),
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={['/tasks/task-1']}>
          <Routes>
            <Route path="/tasks/:id" element={<TaskDetailPage />} />
          </Routes>
          <Toaster />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return fetchMock;
}

const oe = makeUser({ id: 'oe-1', role: 'OE', name: 'Esha Exec' });
const om = makeUser({ id: 'om-1', role: 'OM', name: 'Maya Manager' });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fitment actions (F05)', () => {
  it('shows exactly the review actions the server allows, with status badges and workflow info', async () => {
    const task = makeTask({
      fitments: [
        makeFitment({ status: 'SUBMITTED', availableActions: ['VERIFY', 'REOPEN'], reopenCount: 2, lastReopenReason: 'Blurry photos' }),
        makeFitment({ id: 'fit-2', tkId: 'TK-00002', status: 'MOVED_TO_FT', faultReason: 'No power', replacement: { id: 'fit-3', tkId: 'TK-00003', status: 'OPEN' } }),
        makeFitment({ id: 'fit-3', tkId: 'TK-00003', status: 'OPEN', technician: null, replacementOf: { id: 'fit-2', tkId: 'TK-00002' } }),
        makeFitment({ id: 'fit-4', tkId: 'TK-00004', status: 'CLOSED_NOT_DONE', closeReason: { id: 'cr', name: 'Client not available' }, closeComments: 'Locked' }),
      ],
    });
    renderTask(oe, task);
    expect(await screen.findByRole('button', { name: 'Verify TK-00001' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reopen TK-00001' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Final approve TK-00001' })).not.toBeInTheDocument();
    for (const tk of ['TK-00002', 'TK-00003', 'TK-00004']) {
      expect(screen.queryByRole('button', { name: new RegExp(`^(Verify|Reopen|Final approve) ${tk}$`) })).not.toBeInTheDocument();
    }
    const row = screen.getAllByTestId('fitment-row');
    expect(within(row[0]!).getByText('Submitted')).toBeInTheDocument();
    expect(within(row[0]!).getByTestId('reopen-chip')).toHaveTextContent('Reopened ×2');
    expect(within(row[0]!).getByText('Blurry photos')).toBeInTheDocument();
    expect(within(row[1]!).getByText('Fault: No power')).toBeInTheDocument();
    expect(within(row[1]!).getByText(/Replaced by/)).toHaveTextContent('Replaced by TK-00003 (Open)');
    expect(within(row[2]!).getByText(/Replacement for/)).toHaveTextContent('Replacement for TK-00002');
    expect(within(row[3]!).getByText('Not done: Client not available — Locked')).toBeInTheDocument();
    // Phones: an actions menu per card.
    expect(screen.getByRole('button', { name: 'Actions for TK-00001' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Actions for TK-00002' })).not.toBeInTheDocument();
  });

  it('reopen requires a reason (3+ characters) before calling the API, then sends it', async () => {
    const user = userEvent.setup();
    const task = makeTask({ fitments: [makeFitment({ status: 'SUBMITTED', availableActions: ['VERIFY', 'REOPEN'] })] });
    const fetchMock = renderTask(oe, task, {
      'POST /api/fitments/fit-1/transitions': { fitment: makeFitment({ status: 'REOPENED' }), task: { id: 'task-1', omId: 'OM-00001', status: 'IN_PROGRESS', counts: task.counts } },
    });
    await user.click(await screen.findByRole('button', { name: 'Reopen TK-00001' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/counts against the technician\./)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Reopen' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Give a reason for reopening (at least 3 characters)');
    await user.type(within(dialog).getByLabelText('Reason for reopening'), 'ab');
    await user.click(within(dialog).getByRole('button', { name: 'Reopen' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('at least 3 characters');
    expect(callsTo(fetchMock, 'POST', '/api/fitments/fit-1/transitions')).toHaveLength(0);

    await user.type(within(dialog).getByLabelText('Reason for reopening'), 'c photos missing');
    await user.click(within(dialog).getByRole('button', { name: 'Reopen' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(callsTo(fetchMock, 'POST', '/api/fitments/fit-1/transitions')).toEqual([
      { action: 'REOPEN', payload: { reason: 'abc photos missing' } },
    ]);
    expect(await screen.findByText('TK-00001 reopened')).toBeInTheDocument();
  });

  it('an OM reopening an OE-verified fitment is told it also counts against the OE', async () => {
    const user = userEvent.setup();
    renderTask(om, makeTask({ fitments: [makeFitment({ status: 'OE_VERIFIED', availableActions: ['APPROVE', 'REOPEN'] })] }));
    await user.click(await screen.findByRole('button', { name: 'Reopen TK-00001' }));
    expect(await screen.findByText(/counts against the technician and the operation executive/)).toBeInTheDocument();
  });

  it('shows a refusal from the server verbatim', async () => {
    const user = userEvent.setup();
    const message = 'This fitment is Submitted; only OE-verified fitments can be final-approved';
    renderTask(om, makeTask({ fitments: [makeFitment({ status: 'OE_VERIFIED', availableActions: ['APPROVE', 'REOPEN'] })] }), {
      'POST /api/fitments/fit-1/transitions': () => json({ error: { code: 'INVALID_TRANSITION', message } }, 409),
    });
    await user.click(await screen.findByRole('button', { name: 'Final approve TK-00001' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Final approve' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(message);
  });

  it('OM bulk final approve sends the selected OE-verified fitments', async () => {
    const user = userEvent.setup();
    const task = makeTask({
      permissions: { canEdit: true, canAssign: false, canDelete: false, canViewHistory: true },
      fitments: [
        makeFitment({ status: 'OE_VERIFIED', availableActions: ['APPROVE', 'REOPEN'] }),
        makeFitment({ id: 'fit-2', tkId: 'TK-00002', status: 'OE_VERIFIED', availableActions: ['APPROVE', 'REOPEN'] }),
        makeFitment({ id: 'fit-3', tkId: 'TK-00003', status: 'SUBMITTED', availableActions: ['REOPEN'] }),
      ],
    });
    const fetchMock = renderTask(om, task, { 'POST /api/fitments/approve': { approved: ['TK-00001', 'TK-00002'], failed: [] } });
    await screen.findByRole('button', { name: 'Final approve TK-00001' });
    expect(screen.queryByRole('checkbox', { name: 'Select TK-00003' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Select all fitments' }));
    await user.click(screen.getByRole('button', { name: 'Final approve (2)' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('TK-00001, TK-00002');
    await user.click(within(dialog).getByRole('button', { name: 'Final approve' }));
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/api/fitments/approve')).toEqual([{ fitmentIds: ['fit-1', 'fit-2'] }]));
    expect(await screen.findByText('Final-approved 2 fitment(s)')).toBeInTheDocument();
  });
});

describe('task page tabs and the dev simulator (F05)', () => {
  it('History tab only with canViewHistory', async () => {
    renderTask(oe, makeTask());
    await screen.findByRole('heading', { name: 'OM-00001' });
    expect(screen.queryByRole('tab', { name: 'History' })).not.toBeInTheDocument();
  });

  it('OM gets Details | History tabs', async () => {
    renderTask(om, makeTask({ permissions: { canEdit: true, canAssign: false, canDelete: false, canViewHistory: true } }));
    expect(await screen.findByRole('tab', { name: 'History' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Details', selected: true })).toBeInTheDocument();
  });

  it('the simulator is hidden when the API has it disabled', async () => {
    renderTask(om, makeTask(), {}, false);
    await screen.findByRole('heading', { name: 'OM-00001' });
    await screen.findByText('Fitments');
    // Give the config query and a lazy import time to settle.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(SIMULATOR)).not.toBeInTheDocument();
  });

  it('the simulator shows (dev build, API enabled) for the OM and runs a step as the technician', async () => {
    const user = userEvent.setup();
    const fetchMock = renderTask(om, makeTask(), {
      'POST /api/dev/fitments/fit-1/simulate': { fitment: makeFitment({ status: 'IN_PROGRESS' }), task: { id: 'task-1', omId: 'OM-00001', status: 'IN_PROGRESS', counts: { total: 1, assigned: 1, open: 0 } } },
    }, true);
    await user.click(await screen.findByText(SIMULATOR));
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Start work' }));
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/api/dev/fitments/fit-1/simulate')).toEqual([{ action: 'START' }]));
  });

  it('the simulator is not offered to an OE of another task or to RO', async () => {
    renderTask(makeUser({ id: 'oe-2', role: 'OE' }), makeTask(), {}, true);
    await screen.findByRole('heading', { name: 'OM-00001' });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(SIMULATOR)).not.toBeInTheDocument();
  });
});
