import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FitmentDto, TaskDto, UserDto } from '@champ/shared';
import { Toaster } from '@/components/ui/sonner';
import { AuthContext, type AuthContextValue } from '@/lib/auth';
import { callsTo, json, makeFitment, makePhoto, makeTask, makeUser, mockApi } from '@/test/fixtures';
import { TaskDetailPage } from '../task-detail-page';

const PHOTOS = [makePhoto(), makePhoto({ id: 'ph-2', kind: 'AFTER' }), makePhoto({ id: 'ph-3', kind: 'ASSET' })];

function renderTask(actor: UserDto, fitment: FitmentDto, extra: Record<string, unknown> = {}) {
  const task: TaskDto = makeTask({ fitments: [fitment] });
  const fetchMock = mockApi({
    'GET /api/tasks/task-1': task,
    'GET /api/config': { googleClientId: null, devSimulator: false },
    'GET /api/tasks/options': { oes: [], technicians: [] },
    'GET /api/fitments/fit-1/photos': { items: PHOTOS, canViewHistory: true, canManage: fitment.canManagePhotos },
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
const ro = makeUser({ id: 'ro-1', role: 'RO', name: 'Rhea Reader' });

const submitted = makeFitment({
  status: 'SUBMITTED',
  availableActions: ['VERIFY', 'REOPEN'],
  canEditVerification: true,
  canManagePhotos: true,
  submittedAt: '2026-10-12T05:30:00.000Z',
  photoCounts: { active: 3, byKind: { BEFORE: 1, AFTER: 1, ASSET: 1 } },
  verification: { ...makeFitment().verification, otRemarks: 'Device behind the dashboard' },
});

async function openSheet(user: ReturnType<typeof userEvent.setup>, name = 'Verify TK-00001') {
  await user.click(await screen.findByRole('button', { name }));
  return screen.findByRole('dialog');
}

async function choose(user: ReturnType<typeof userEvent.setup>, sheet: HTMLElement, field: RegExp, option: string) {
  await user.click(within(sheet).getByRole('combobox', { name: field }));
  await user.click(await screen.findByRole('option', { name: option }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('verification sheet (F06)', () => {
  it('shows the technician work next to the form; Verify shows the missing required fields without calling the API', async () => {
    const user = userEvent.setup();
    const fetchMock = renderTask(oe, submitted);
    expect(await screen.findByRole('button', { name: 'Photos TK-00001' })).toHaveTextContent('Photos (3)');
    const sheet = await openSheet(user);
    expect(within(sheet).getByRole('heading', { name: 'Verify TK-00001' })).toBeInTheDocument();
    expect(within(sheet).getByTestId('ot-remarks')).toHaveTextContent('Device behind the dashboard');
    expect(await within(sheet).findAllByRole('img')).toHaveLength(3);
    expect(within(sheet).getAllByTestId('photo-group').map((g) => g.querySelector('h3')!.textContent)).toEqual([
      'Before (1)',
      'Asset (1)',
      'After (1)',
    ]);

    await user.click(within(sheet).getByRole('button', { name: 'Verify' }));
    expect(within(sheet).getByRole('alert')).toHaveTextContent('Fill in Issue observed at site, Action taken, Final issue before verifying');
    expect(within(sheet).getByTestId('error-issueObservedId')).toHaveTextContent('Choose the issue observed at site');
    expect(within(sheet).getByTestId('error-actionTakenId')).toHaveTextContent('Choose the action taken');
    expect(within(sheet).getByTestId('error-finalIssueId')).toHaveTextContent('Choose the final issue');
    expect(callsTo(fetchMock, 'POST', '/api/fitments/fit-1/transitions')).toHaveLength(0);
  });

  it('shows a live billable badge, then verifies with every field', async () => {
    const user = userEvent.setup();
    const fetchMock = renderTask(oe, submitted, {
      'POST /api/fitments/fit-1/transitions': { fitment: { ...submitted, status: 'OE_VERIFIED' }, task: { id: 'task-1', omId: 'OM-00001', status: 'IN_PROGRESS', counts: { total: 1, assigned: 1, open: 0 } } },
    });
    const sheet = await openSheet(user);
    expect(within(sheet).queryByTestId('billable-badge')).not.toBeInTheDocument();
    await choose(user, sheet, /^Final issue/, 'Wiring issue');
    expect(within(sheet).getByTestId('billable-badge')).toHaveTextContent('Billable: Yes');
    await choose(user, sheet, /^Final issue/, 'Device fault');
    expect(within(sheet).getByTestId('billable-badge')).toHaveTextContent('Billable: No');

    await choose(user, sheet, /^Issue observed at site/, 'Loose wiring');
    await choose(user, sheet, /^Action taken/, 'Rewired power supply');
    await user.click(within(sheet).getByRole('checkbox', { name: 'Relay' }));
    await user.type(within(sheet).getByLabelText('Remarks from OE'), 'Checked on site');
    await user.click(within(sheet).getByRole('button', { name: 'Verify' }));
    await waitFor(() =>
      expect(callsTo(fetchMock, 'POST', '/api/fitments/fit-1/transitions')).toEqual([
        {
          action: 'VERIFY',
          payload: {
            issueObservedId: 'io-wiring',
            actionTakenId: 'at-rewired',
            accessoryIds: ['acc-relay'],
            oeRemarks: 'Checked on site',
            finalIssueId: 'fi-device',
          },
        },
      ]),
    );
    expect(await screen.findByText('TK-00001 verified')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('verification-sheet')).not.toBeInTheDocument());
  });

  it('Save draft sends the partial entries; a server VERIFICATION_INCOMPLETE is shown inline', async () => {
    const user = userEvent.setup();
    const fetchMock = renderTask(oe, submitted, {
      'PUT /api/fitments/fit-1/verification': { ...submitted.verification, issueObserved: { id: 'io-wiring', name: 'Loose wiring', code: null, active: true } },
      'POST /api/fitments/fit-1/transitions': () =>
        json(
          {
            error: {
              code: 'VERIFICATION_INCOMPLETE',
              message: 'Fill in Final issue before verifying',
              details: { missing: [{ field: 'finalIssueId', label: 'Final issue' }], fieldErrors: { finalIssueId: ['Choose the final issue'] } },
            },
          },
          400,
        ),
    });
    const sheet = await openSheet(user);
    await choose(user, sheet, /^Issue observed at site/, 'Loose wiring');
    await user.click(within(sheet).getByRole('button', { name: 'Save draft' }));
    await waitFor(() =>
      expect(callsTo(fetchMock, 'PUT', '/api/fitments/fit-1/verification')).toEqual([
        { issueObservedId: 'io-wiring', actionTakenId: null, accessoryIds: [], oeRemarks: '', finalIssueId: null },
      ]),
    );
    expect(await screen.findByText('Draft saved for TK-00001')).toBeInTheDocument();

    // The server's own check (e.g. a value changed elsewhere) maps to the fields.
    await choose(user, sheet, /^Action taken/, 'Rewired power supply');
    await choose(user, sheet, /^Final issue/, 'Wiring issue');
    await user.click(within(sheet).getByRole('button', { name: 'Verify' }));
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('Fill in Final issue before verifying');
    expect(within(sheet).getByTestId('error-finalIssueId')).toHaveTextContent('Choose the final issue');
  });

  it('read-only for an RO: the row shows the final issue and billable; the sheet shows values without inputs', async () => {
    const user = userEvent.setup();
    const verified = makeFitment({
      status: 'OE_VERIFIED',
      verifiedAt: '2026-10-12T06:00:00.000Z',
      verifiedBy: { id: 'oe-1', name: 'Esha Exec' },
      photoCounts: { active: 3, byKind: {} },
      verification: {
        issueObserved: { id: 'io-old', name: 'Old issue', code: null, active: false },
        actionTaken: { id: 'at-rewired', name: 'Rewired power supply', code: null, active: true },
        accessories: [{ id: 'acc-relay', name: 'Relay', code: null, active: true }],
        oeRemarks: 'All fine',
        otRemarks: 'Done',
        finalIssue: { id: 'fi-wiring', name: 'Wiring issue', code: null, active: true, billable: true },
        billable: true,
        updatedAt: '2026-10-12T06:00:00.000Z',
        updatedBy: { id: 'oe-1', name: 'Esha Exec' },
      },
    });
    renderTask(ro, verified, { 'GET /api/fitments/fit-1/photos': { items: PHOTOS, canViewHistory: false, canManage: false } });
    const row = (await screen.findAllByTestId('fitment-row'))[0]!;
    expect(within(row).getByTestId('fitment-verification')).toHaveTextContent('Final issue: Wiring issue');
    expect(within(row).getByTestId('billable-badge')).toHaveTextContent('Billable: Yes');

    const sheet = await openSheet(user, 'View verification TK-00001');
    expect(within(sheet).getByRole('heading', { name: 'Verification · TK-00001' })).toBeInTheDocument();
    const values = within(sheet).getByTestId('verification-readonly');
    expect(values).toHaveTextContent('Old issue (inactive)');
    expect(values).toHaveTextContent('Rewired power supply');
    expect(values).toHaveTextContent('Relay');
    expect(values).toHaveTextContent('All fine');
    expect(values).toHaveTextContent('Billable: Yes');
    expect(within(sheet).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: /Save|Verify/ })).not.toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: /Replace/ })).not.toBeInTheDocument();
    expect(within(sheet).queryByText('Show history')).not.toBeInTheDocument();
  });

  it('an OE editing a verified fitment sees the saved snapshot until the final issue changes', async () => {
    const user = userEvent.setup();
    const verified = makeFitment({
      status: 'OE_VERIFIED',
      canEditVerification: true,
      verification: {
        ...submitted.verification,
        issueObserved: { id: 'io-wiring', name: 'Loose wiring', code: null, active: true },
        actionTaken: { id: 'at-rewired', name: 'Rewired power supply', code: null, active: true },
        // The master flag was flipped after verification; the snapshot stays Yes.
        finalIssue: { id: 'fi-device', name: 'Device fault', code: null, active: true, billable: false },
        billable: true,
      },
    });
    const fetchMock = renderTask(oe, verified, { 'PUT /api/fitments/fit-1/verification': verified.verification });
    const sheet = await openSheet(user, 'Edit verification TK-00001');
    expect(within(sheet).getByTestId('billable-badge')).toHaveTextContent('Billable: Yes');
    await choose(user, sheet, /^Final issue/, 'Wiring issue');
    expect(within(sheet).getByTestId('billable-badge')).toHaveTextContent('Billable: Yes');
    await choose(user, sheet, /^Final issue/, 'Device fault');
    expect(within(sheet).getByTestId('billable-badge')).toHaveTextContent('Billable: Yes');
    expect(within(sheet).queryByRole('button', { name: 'Verify' })).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(callsTo(fetchMock, 'PUT', '/api/fitments/fit-1/verification')).toHaveLength(1));
  });
});

describe("technician's form on the verification sheet (F10B)", () => {
  it('shows the checks with Not OK highlighted, readings, device replacement, device ids, comments and times', async () => {
    const user = userEvent.setup();
    renderTask(
      oe,
      makeFitment({
        ...submitted,
        startedAt: '2026-10-12T04:00:00.000Z',
        technicianForm: {
          vehicleRegNo: 'KA01AB1234',
          chassisNo: null,
          clusterReadingKm: 123456,
          deviceReplacement: 'SIM',
          deviceId: 'DEV-001',
          secondaryDeviceId: null,
          checks: { assetCondition: 'OK', accessories: 'NOT_OK', batteryCondition: 'NA', canVoltage: 'OK' },
          comments: 'Device behind the dashboard',
          updatedAt: '2026-10-12T05:00:00.000Z',
        },
      }),
    );
    const sheet = await openSheet(user);
    const form = within(sheet).getByTestId('technician-form');
    expect(within(form).getByText("Technician's form")).toBeInTheDocument();
    expect(within(form).getByTestId('check-accessories')).toHaveTextContent('AccessoriesNot OK');
    expect(within(form).getByTestId('check-accessories').querySelector('[data-not-ok]')).not.toBeNull();
    expect(within(form).getByTestId('check-assetCondition').querySelector('[data-not-ok]')).toBeNull();
    expect(within(form).getByTestId('check-batteryCondition')).toHaveTextContent('Not applicable');
    expect(within(form).getByTestId('check-clusterMeter')).toHaveTextContent('Not answered');
    expect(form).toHaveTextContent('Vehicle registration no.KA01AB1234');
    expect(form).toHaveTextContent('Cluster reading (km)1,23,456 km');
    expect(form).toHaveTextContent('Device replacementSIM');
    expect(form).toHaveTextContent('Device idDEV-001');
    expect(form).toHaveTextContent('Secondary device id—');
    expect(form).toHaveTextContent('Started (IST)');
    expect(form).toHaveTextContent('Submitted (IST)');
    expect(within(form).getByTestId('ot-remarks')).toHaveTextContent('Device behind the dashboard');
    // Above the OE fields: the form section precedes the verification heading in document order.
    const verifyHeading = within(sheet).getByRole('heading', { name: 'Verification' });
    expect(form.compareDocumentPosition(verifyHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
