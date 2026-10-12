import {
  EMPTY_FITMENT_FORM,
  mobileDateOptions,
  type ApproveVisitDetailDto,
  type ApproveVisitItemDto,
  type FitmentPhotoDto,
  type LookupsResponse,
} from '@champ/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import { jsonBody, mockFetch, renderWithProviders, router, type Route } from '../test/utils';
import { ApproveVisitDetailScreen } from './approve-visit-detail-screen';
import { ApproveVisitScreen } from './approve-visit-screen';

const params = useLocalSearchParams as jest.Mock;
const [TODAY] = mobileDateOptions(new Date()) as string[];

const item = (over: Partial<ApproveVisitItemDto> = {}): ApproveVisitItemDto => ({
  fitmentId: 'f1',
  tkId: 'TK-00012',
  customer: 'Acme Logistics',
  site: { name: 'Peenya depot', address: null },
  technician: { id: 'u1', name: 'Ravi Kumar' },
  vehicleRegNo: 'KA01AB1234',
  submittedAt: '2026-10-12T10:42:00.000Z',
  ...over,
});

const detail = (over: Partial<ApproveVisitDetailDto> = {}): ApproveVisitDetailDto => ({
  item: item(),
  status: 'SUBMITTED',
  isVehicle: true,
  form: { ...EMPTY_FITMENT_FORM, vehicleRegNo: 'KA01AB1234', comments: 'All good' },
  photos: [{ id: 'p1', kind: 'BEFORE', url: 'https://img/before.jpg' } as FitmentPhotoDto],
  verification: {
    issueObserved: null,
    actionTaken: null,
    accessories: [],
    oeRemarks: null,
    otRemarks: 'Re-crimped the CAN wire',
    finalIssue: null,
    billable: null,
    updatedAt: null,
    updatedBy: null,
  },
  startedAt: '2026-10-12T09:00:00.000Z',
  availableActions: ['VERIFY', 'REOPEN'],
  ...over,
});

const lookups = {
  issuesObserved: [{ id: 'io1', name: 'Loose wiring', code: null }],
  actionsTaken: [{ id: 'at1', name: 'Rewired', code: null }],
  finalIssues: [
    { id: 'fi1', name: 'Installation done', code: null, billable: true },
    { id: 'fi2', name: 'No issue', code: null, billable: false },
  ],
  accessories: [
    { id: 'ac1', name: 'Relay', code: null },
    { id: 'ac2', name: 'Buzzer', code: null },
  ],
} as unknown as LookupsResponse;

beforeEach(() => {
  jest.clearAllMocks();
  params.mockReturnValue({ id: 'f1' });
});

describe('ApproveVisitScreen', () => {
  it('lists the waiting fitments and opens one', async () => {
    const fetchMock = mockFetch(() => ({ status: 200, body: { date: TODAY, items: [item()] } }));
    await renderWithProviders(<ApproveVisitScreen />, { date: TODAY });
    expect(await screen.findByText('TK-00012')).toBeOnTheScreen();
    expect(screen.getByText('Ravi Kumar')).toBeOnTheScreen();
    expect(screen.getByText('Acme Logistics · Peenya depot')).toBeOnTheScreen();
    expect(screen.getByText(/Submitted 0?4:12\s?pm/i)).toBeOnTheScreen();
    expect(new URL(fetchMock.mock.calls[0]?.[0] as string).searchParams.get('date')).toBe(TODAY);
    await fireEvent.press(screen.getByTestId('visit-f1'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/approve-visit/[id]', params: { id: 'f1' } });
  });

  it('shows the empty state', async () => {
    mockFetch(() => ({ status: 200, body: { date: TODAY, items: [] } }));
    await renderWithProviders(<ApproveVisitScreen />, { date: TODAY });
    expect(await screen.findByText('Nothing waiting for you on this day')).toBeOnTheScreen();
  });
});

describe('ApproveVisitDetailScreen', () => {
  function detailApi(transition: Route, list: ApproveVisitItemDto[] = [item(), item({ fitmentId: 'f2', tkId: 'TK-00013' })]) {
    return mockFetch((url, init) => {
      if (url.pathname === '/api/mobile/approve-visit/f1') return { status: 200, body: detail() };
      if (url.pathname === '/api/mobile/approve-visit') return { status: 200, body: { date: TODAY, items: list } };
      if (url.pathname === '/api/lookups') return { status: 200, body: lookups };
      if (url.pathname === '/api/fitments/f1/transitions') return transition(url, init);
      return { status: 404 };
    });
  }
  const transitionCall = (fetchMock: jest.Mock) =>
    fetchMock.mock.calls.find(([u]) => new URL(u as string).pathname === '/api/fitments/f1/transitions');

  async function choose() {
    await fireEvent.press(await screen.findByTestId('pick-issueObservedId'));
    await fireEvent.press(screen.getByTestId('option-issueObservedId-io1'));
    await fireEvent.press(screen.getByTestId('pick-actionTakenId'));
    await fireEvent.press(screen.getByTestId('option-actionTakenId-at1'));
    await fireEvent.press(screen.getByTestId('pick-finalIssueId'));
    await fireEvent.press(screen.getByTestId('option-finalIssueId-fi1'));
  }

  it('shows the form read only and the photos', async () => {
    detailApi(() => ({ status: 200 }));
    await renderWithProviders(<ApproveVisitDetailScreen />, { date: TODAY });
    expect(await screen.findByTestId('summary-vehicleRegNo')).toHaveTextContent('KA01AB1234');
    expect(screen.getByTestId('summary-comments')).toHaveTextContent('All good');
    expect(screen.getByTestId('technician')).toHaveTextContent('Ravi Kumar');
    expect(screen.getByText('Re-crimped the CAN wire')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('thumb-BEFORE'));
    expect(screen.getByTestId('photo-viewer')).toBeOnTheScreen();
  });

  it('blocks Verify until the three fields are chosen, then verifies and opens the next fitment', async () => {
    const fetchMock = detailApi(() => ({ status: 200, body: {} }));
    await renderWithProviders(<ApproveVisitDetailScreen />, { date: TODAY });
    await fireEvent.press(await screen.findByTestId('verify'));
    expect(screen.getByTestId('verify-errors')).toHaveTextContent(/Choose the issue observed at site/);
    expect(screen.getByTestId('verify-errors')).toHaveTextContent(/Choose the final issue/);
    expect(transitionCall(fetchMock)).toBeUndefined();

    await choose();
    expect(screen.getByText('Billable')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('pick-accessories'));
    await fireEvent.press(screen.getByTestId('accessory-ac2'));
    await fireEvent.press(screen.getByTestId('accessories-done'));
    await fireEvent.changeText(screen.getByTestId('oe-remarks'), '  Looks fine  ');
    await fireEvent.press(screen.getByTestId('verify'));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith({ pathname: '/approve-visit/[id]', params: { id: 'f2' } }));
    const [, init] = transitionCall(fetchMock) as [string, RequestInit];
    expect(jsonBody(init)).toEqual({
      action: 'VERIFY',
      payload: { issueObservedId: 'io1', actionTakenId: 'at1', finalIssueId: 'fi1', accessoryIds: ['ac2'], oeRemarks: 'Looks fine' },
    });
    expect(await screen.findByText('TK-00012 verified')).toBeOnTheScreen();
  });

  it('goes back to the list when nothing else is waiting', async () => {
    detailApi(() => ({ status: 200, body: {} }), []);
    await renderWithProviders(<ApproveVisitDetailScreen />, { date: TODAY });
    await choose();
    await fireEvent.press(screen.getByTestId('verify'));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('reopens with a reason', async () => {
    const fetchMock = detailApi(() => ({ status: 200, body: {} }));
    await renderWithProviders(<ApproveVisitDetailScreen />, { date: TODAY });
    await fireEvent.press(await screen.findByTestId('reopen'));
    expect(screen.getByTestId('reopen-confirm')).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('reopen-reason'), 'Wrong device id');
    await fireEvent.press(screen.getByTestId('reopen-confirm'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith({ pathname: '/approve-visit/[id]', params: { id: 'f2' } }));
    const [, init] = transitionCall(fetchMock) as [string, RequestInit];
    expect(jsonBody(init)).toEqual({ action: 'REOPEN', payload: { reason: 'Wrong device id' } });
    expect(await screen.findByText('TK-00012 reopened')).toBeOnTheScreen();
  });

  it('a 409 (handled meanwhile) shows a toast and goes back to the list', async () => {
    detailApi(() => ({ status: 409, body: { error: { code: 'INVALID_TRANSITION', message: 'TK-00012 is already OE verified' } } }));
    await renderWithProviders(<ApproveVisitDetailScreen />, { date: TODAY });
    await choose();
    await fireEvent.press(screen.getByTestId('verify'));
    expect(await screen.findByText('TK-00012 is already OE verified')).toBeOnTheScreen();
    expect(router.back).toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('shows a server VERIFICATION_INCOMPLETE message', async () => {
    detailApi(() => ({ status: 400, body: { error: { code: 'VERIFICATION_INCOMPLETE', message: 'Fill in Final issue before verifying' } } }));
    await renderWithProviders(<ApproveVisitDetailScreen />, { date: TODAY });
    await choose();
    await fireEvent.press(screen.getByTestId('verify'));
    expect(await screen.findByText('Fill in Final issue before verifying')).toBeOnTheScreen();
    expect(router.back).not.toHaveBeenCalled();
  });
});
