import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TaskDto, TaskOptionsResponse, UserDto, WorkflowFitmentItemDto } from '@champ/shared';
import { Toaster } from '@/components/ui/sonner';
import { AuthContext, type AuthContextValue } from '@/lib/auth';
import { callsTo, makeFitment, makeTask, makeUser, mockApi } from '@/test/fixtures';
import { FitmentListPage } from './fitment-list-page';
import { TaskDetailPage } from './task-detail-page';

// CR-11: Undo faulty (task page, Faulty view) and Assign replacement (Faulty view).
const oe = makeUser({ id: 'oe-1', role: 'OE', name: 'Esha Exec' });
const options: TaskOptionsResponse = {
  oes: [{ id: 'oe-1', name: 'Esha Exec' }],
  technicians: [{ id: 'ot-arjun', name: 'Arjun Singh', technicianType: 'PAYROLL', baseLocation: 'Pune' }],
  assignableOes: [],
};
const transitionOk = { fitment: makeFitment(), task: { id: 'task-1', omId: 'OM-00001', status: 'IN_PROGRESS', counts: makeTask().counts } };

function renderAt(path: string, routes: Record<string, unknown>, actor: UserDto = oe) {
  const fetchMock = mockApi({ 'GET /api/config': { googleClientId: null, devSimulator: false }, 'GET /api/tasks/options': options, ...routes });
  const auth: AuthContextValue = {
    status: 'authenticated',
    user: actor,
    login: vi.fn(),
    loginWithGoogle: vi.fn(),
    startSession: vi.fn(),
    logout: vi.fn(),
  };
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/tasks/faulty" element={<FitmentListPage list="faulty" />} />
            <Route path="/tasks/:id" element={<TaskDetailPage />} />
          </Routes>
          <Toaster />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return fetchMock;
}

function faultyItem(overrides: Partial<WorkflowFitmentItemDto> = {}): WorkflowFitmentItemDto {
  return {
    id: 'fit-1',
    tkId: 'TK-00012',
    status: 'MOVED_TO_FT',
    task: { id: 'task-1', omId: 'OM-00001' },
    client: { id: 'c-1', name: 'Zoomcar' },
    site: { id: 's-1', name: 'Bengaluru depot' },
    technician: { id: 'ot-1', name: 'Ravi Kumar' },
    oe: { id: 'oe-1', name: 'Esha Exec' },
    vehicleRegNo: 'KA01AB1234',
    verifiedAt: null,
    verifiedBy: null,
    reopenCount: 0,
    lastReopenReason: null,
    lastReopenedAt: null,
    lastReopenedBy: null,
    faultReason: 'No power',
    faultyAt: '2026-10-12T05:00:00.000Z',
    replacement: { id: 'fit-31', tkId: 'TK-00031', status: 'OPEN', technician: null },
    availableActions: ['UNDO_FAULTY'],
    canAssignReplacement: true,
    ...overrides,
  };
}
const page = (items: WorkflowFitmentItemDto[]) => ({ items, total: items.length, page: 1, pageSize: 20 });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Undo faulty on the task page (CR-11)', () => {
  it('is offered when the server lists it, explains the effect and posts the reason', async () => {
    const user = userEvent.setup();
    const task: TaskDto = makeTask({
      fitments: [
        makeFitment({ status: 'MOVED_TO_FT', tkId: 'TK-00012', availableActions: ['UNDO_FAULTY'], replacement: { id: 'fit-31', tkId: 'TK-00031', status: 'ASSIGNED' } }),
      ],
    });
    const fetchMock = renderAt('/tasks/task-1', { 'GET /api/tasks/task-1': task, 'POST /api/fitments/fit-1/transitions': transitionOk });
    await user.click(await screen.findByRole('button', { name: 'Undo faulty TK-00012' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(
      'TK-00012 goes back to Assigned with Ravi Kumar; its replacement TK-00031 will be closed as "Faulty marked by mistake".',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Undo faulty' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Give a reason for undoing the fault marking (at least 3 characters)');
    expect(callsTo(fetchMock, 'POST', '/api/fitments/fit-1/transitions')).toHaveLength(0);

    await user.type(within(dialog).getByLabelText('Reason for undoing'), '  Device was fine ');
    await user.click(within(dialog).getByRole('button', { name: 'Undo faulty' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(callsTo(fetchMock, 'POST', '/api/fitments/fit-1/transitions')).toEqual([{ action: 'UNDO_FAULTY', payload: { reason: 'Device was fine' } }]);
    expect(await screen.findByText('TK-00012 is back to Assigned')).toBeInTheDocument();
  });

  it('is not offered without UNDO_FAULTY in the available actions', async () => {
    const task = makeTask({ fitments: [makeFitment({ status: 'MOVED_TO_FT', availableActions: [] })] });
    renderAt('/tasks/task-1', { 'GET /api/tasks/task-1': task });
    await screen.findAllByTestId('fitment-row');
    expect(screen.queryByRole('button', { name: /^Undo faulty/ })).not.toBeInTheDocument();
  });
});

describe('Faulty view row actions (CR-11)', () => {
  it('shows the replacement and offers each action only by its flag', async () => {
    renderAt('/tasks/faulty', {
      'GET /api/fitments/faulty': page([
        faultyItem(),
        faultyItem({
          id: 'fit-2',
          tkId: 'TK-00013',
          replacement: { id: 'fit-32', tkId: 'TK-00032', status: 'IN_PROGRESS', technician: { id: 'ot-1', name: 'Ravi Kumar' } },
          availableActions: [],
          canAssignReplacement: false,
        }),
      ]),
    });
    const rows = await screen.findAllByTestId('fitment-list-row');
    expect(within(rows[0]!).getByTestId('replacement')).toHaveTextContent('TK-00031');
    expect(within(rows[0]!).getByTestId('replacement')).toHaveTextContent('Not assigned');
    expect(within(rows[0]!).getByRole('button', { name: 'Assign replacement TK-00031' })).toBeInTheDocument();
    expect(within(rows[0]!).getByRole('button', { name: 'Undo faulty TK-00012' })).toBeInTheDocument();
    expect(within(rows[1]!).getByTestId('replacement')).toHaveTextContent('Ravi Kumar');
    expect(within(rows[1]!).queryByRole('button')).not.toBeInTheDocument();
    // Phone cards carry the same actions.
    const cards = screen.getAllByTestId('fitment-list-card');
    expect(within(cards[0]!).getByRole('button', { name: 'Assign replacement TK-00031' })).toBeInTheDocument();
    expect(within(cards[1]!).queryByRole('button')).not.toBeInTheDocument();
  });

  it('no actions column when no row has an action', async () => {
    renderAt('/tasks/faulty', { 'GET /api/fitments/faulty': page([faultyItem({ availableActions: [], canAssignReplacement: false })]) });
    await screen.findAllByTestId('fitment-list-row');
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).not.toBeInTheDocument();
  });

  it('Assign replacement posts to the replacement task and refreshes the list', async () => {
    const user = userEvent.setup();
    let assigned = false;
    const fetchMock = renderAt('/tasks/faulty', {
      'GET /api/fitments/faulty': () =>
        page([faultyItem(assigned ? { replacement: { id: 'fit-31', tkId: 'TK-00031', status: 'ASSIGNED', technician: { id: 'ot-arjun', name: 'Arjun Singh' } } } : {})]),
      'POST /api/tasks/task-1/assign': () => {
        assigned = true;
        return makeTask();
      },
    });
    const [row] = await screen.findAllByTestId('fitment-list-row');
    await user.click(within(row!).getByRole('button', { name: 'Assign replacement TK-00031' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Assign replacement TK-00031');
    await user.click(within(dialog).getByRole('combobox', { name: 'Technician' }));
    await user.click(await screen.findByRole('option', { name: /Arjun Singh/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(callsTo(fetchMock, 'POST', '/api/tasks/task-1/assign')).toEqual([{ fitmentIds: ['fit-31'], technicianId: 'ot-arjun' }]);
    await waitFor(() => expect(within(screen.getAllByTestId('fitment-list-row')[0]!).getByTestId('replacement')).toHaveTextContent('Arjun Singh'));
  });

  it('Undo faulty from a row posts the reason for that fitment', async () => {
    const user = userEvent.setup();
    const fetchMock = renderAt('/tasks/faulty', { 'GET /api/fitments/faulty': page([faultyItem()]), 'POST /api/fitments/fit-1/transitions': transitionOk });
    const [row] = await screen.findAllByTestId('fitment-list-row');
    await user.click(within(row!).getByRole('button', { name: 'Undo faulty TK-00012' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('its replacement TK-00031 will be closed as "Faulty marked by mistake"');
    await user.type(within(dialog).getByLabelText('Reason for undoing'), 'Marked by mistake');
    await user.click(within(dialog).getByRole('button', { name: 'Undo faulty' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(callsTo(fetchMock, 'POST', '/api/fitments/fit-1/transitions')).toEqual([{ action: 'UNDO_FAULTY', payload: { reason: 'Marked by mistake' } }]);
  });
});
