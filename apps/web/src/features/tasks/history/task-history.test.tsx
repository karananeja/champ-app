import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TaskEventDto, TaskHistoryResponse } from '@champ/shared';
import { mockApi } from '@/test/fixtures';
import { eventDetails } from './event-details';
import { TaskHistory } from './task-history';

const om = { id: 'om-1', name: 'Maya Manager' };
const oe = { id: 'oe-1', name: 'Esha Exec' };
const ot = { id: 'ot-1', name: 'Ravi Kumar' };
const step = (at: string, by: { id: string; name: string }, completedAt: string | null = null, completedBy = by) => ({
  at,
  by,
  completedAt,
  completedBy: completedAt ? completedBy : null,
});

const history: TaskHistoryResponse = {
  task: {
    first: step('2026-10-12T04:00:00.000Z', om, '2026-10-12T04:00:00.000Z'),
    second: step('2026-10-12T05:00:00.000Z', ot),
    verification: null,
    final: null,
  },
  fitments: [
    {
      id: 'fit-1',
      tkId: 'TK-00001',
      status: 'SUBMITTED',
      technician: ot,
      stages: {
        first: step('2026-10-12T04:00:00.000Z', om, '2026-10-12T04:00:00.000Z'),
        second: step('2026-10-12T07:00:00.000Z', ot, '2026-10-12T07:30:00.000Z'),
        verification: null,
        final: null,
      },
      reopenLoops: [
        {
          at: '2026-10-12T06:30:00.000Z',
          by: om,
          fromStatus: 'OE_VERIFIED',
          reason: 'Wrong device id',
          attributions: [
            { user: oe, role: 'OE' },
            { user: ot, role: 'OT' },
          ],
        },
      ],
    },
  ],
};

const events: TaskEventDto[] = [
  { id: 'e1', at: '2026-10-12T04:00:00.000Z', actor: om, fitment: null, type: 'TASK_CREATED', fromStatus: null, toStatus: 'ASSIGNED', data: { omId: 'OM-00001' } },
  { id: 'e2', at: '2026-10-12T05:00:00.000Z', actor: ot, fitment: { id: 'fit-1', tkId: 'TK-00001' }, type: 'FITMENT_STARTED', fromStatus: 'ASSIGNED', toStatus: 'IN_PROGRESS', data: { tkId: 'TK-00001', lat: 12.97, lng: 77.59, simulated: true } },
  { id: 'e3', at: '2026-10-12T05:10:00.000Z', actor: om, fitment: null, type: 'TASK_UPDATED', fromStatus: null, toStatus: null, data: { pocName: ['Priya Rao', 'Anil'], postStart: true } },
];

function renderHistory(items: TaskEventDto[] = events) {
  const fetchMock = mockApi({
    'GET /api/tasks/task-1/history': history,
    'GET /api/tasks/task-1/events': (url: string) =>
      url.includes('format=csv')
        ? new Response(new Blob(['csv']), { headers: { 'Content-Disposition': 'attachment; filename=champ-OM-00001-events-20261012-1000.csv' } })
        : { items },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TaskHistory taskId="task-1" omId="OM-00001" />
    </QueryClientProvider>,
  );
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TaskHistory', () => {
  it('renders the task stepper, per-fitment stages with reopen loops, and the raw data with diffs', async () => {
    const user = userEvent.setup();
    renderHistory();
    const taskStages = await screen.findByRole('list', { name: 'Task stages' });
    const states = within(taskStages).getAllByRole('listitem').map((li) => li.getAttribute('data-state'));
    expect(states).toEqual(['done', 'current', 'pending', 'pending']);
    expect(within(taskStages).getByText('12 Oct 2026, 10:30 · Ravi Kumar')).toBeInTheDocument(); // IST

    await user.click(screen.getByRole('button', { name: /TK-00001/ }));
    const fitmentStages = screen.getByRole('list', { name: 'TK-00001 stages' });
    expect(within(fitmentStages).getAllByRole('listitem').map((li) => li.getAttribute('data-state'))).toEqual(['done', 'done', 'pending', 'pending']);
    const loop = screen.getByTestId('reopen-loop');
    expect(loop).toHaveTextContent('Maya Manager reopened it (was OE verified)');
    expect(loop).toHaveTextContent('Reason: Wrong device id');
    expect(loop).toHaveTextContent('Counts against: Esha Exec (OE), Ravi Kumar (OT)');

    const rows = await screen.findAllByTestId('event-row');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent('Started');
    expect(rows[1]).toHaveTextContent('ASSIGNED → IN_PROGRESS');
    await user.click(within(rows[2]!).getByRole('button', { name: 'Details' }));
    const details = within(rows[2]!).getByTestId('event-details');
    expect(details).toHaveTextContent('pocName: Priya Rao → Anil');
    expect(details).toHaveTextContent('postStart: true');
  });

  it('F11: shows "Filled from CSV" with its readable diff', async () => {
    const user = userEvent.setup();
    renderHistory([
      {
        id: 'e9',
        at: '2026-10-12T06:00:00.000Z',
        actor: ot,
        fitment: { id: 'fit-1', tkId: 'TK-00001' },
        type: 'FITMENT_FORM_CSV_FILLED',
        fromStatus: null,
        toStatus: null,
        data: { tkId: 'TK-00001', 'Device id': ['OLD', 'NEW-1'], Accessories: [null, 'OK'] },
      },
    ]);
    const [row] = await screen.findAllByTestId('event-row');
    expect(row).toHaveTextContent('Filled from CSV');
    await user.click(within(row!).getByRole('button', { name: 'Details' }));
    const details = within(row!).getByTestId('event-details');
    expect(details).toHaveTextContent('Device id: OLD → NEW-1');
    expect(details).toHaveTextContent('Accessories: — → OK');
  });

  it('CR-11: shows "Fault undone" with the reason and the replacement', async () => {
    const user = userEvent.setup();
    renderHistory([
      {
        id: 'e10',
        at: '2026-10-12T06:00:00.000Z',
        actor: oe,
        fitment: { id: 'fit-1', tkId: 'TK-00001' },
        type: 'FITMENT_FAULT_UNDONE',
        fromStatus: 'MOVED_TO_FT',
        toStatus: 'ASSIGNED',
        data: { tkId: 'TK-00001', reason: 'Device was fine', replacementTkId: 'TK-00002' },
      },
    ]);
    const [row] = await screen.findAllByTestId('event-row');
    expect(row).toHaveTextContent('Fault undone');
    await user.click(within(row!).getByRole('button', { name: 'Details' }));
    const details = within(row!).getByTestId('event-details');
    expect(details).toHaveTextContent('Device was fine');
    expect(details).toHaveTextContent('TK-00002');
  });

  it('filters the raw data by fitment and downloads the CSV', async () => {
    const user = userEvent.setup();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const fetchMock = renderHistory();
    await screen.findAllByTestId('event-row');
    await user.click(screen.getByRole('combobox', { name: 'Filter events' }));
    await user.click(await screen.findByRole('option', { name: 'TK-00001' }));
    expect(screen.getAllByTestId('event-row')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Download CSV' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(fetchMock.mock.calls.map(([url]) => url as string)).toContain('/api/tasks/task-1/events?format=csv');
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('champ-OM-00001-events-20261012-1000.csv');
  });

  it('eventDetails splits diffs from plain values', () => {
    expect(eventDetails({ chassisNo: [null, 'CH-9'], postApproval: true, attributions: [{ userId: 'a' }, { userId: 'b' }] })).toEqual([
      { key: 'chassisNo', before: '—', after: 'CH-9' },
      { key: 'postApproval', value: 'true' },
      { key: 'attributions', value: '[{"userId":"a"},{"userId":"b"}]' },
    ]);
    expect(eventDetails(null)).toEqual([]);
  });

  it('eventDetails (F06): photo ids and kinds are lists, verification diffs are before/after', () => {
    expect(eventDetails({ photoIds: ['a', 'b'], kinds: ['BEFORE', 'AFTER'], finalIssue: [null, 'Wiring issue'], billable: [true, false] })).toEqual([
      { key: 'photoIds', value: 'a, b' },
      { key: 'kinds', value: 'BEFORE, AFTER' },
      { key: 'finalIssue', before: '—', after: 'Wiring issue' },
      { key: 'billable', before: 'true', after: 'false' },
    ]);
  });
});
