import { mobileDateOptions, type DayHistoryDto, type ReporteesHistoryResponse } from '@champ/shared';
import { fireEvent, screen } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSession } from '../lib/session';
import { fakeSession } from '../test/session-mock';
import { makeUser, mockFetch, renderWithProviders, router } from '../test/utils';
import { HistoryScreen } from './history-screen';
import { ReporteeHistoryScreen } from './reportee-history-screen';

jest.mock('../lib/session');
const mockedUseSession = jest.mocked(useSession);
const params = useLocalSearchParams as jest.Mock;

const [TODAY, , THIRD] = mobileDateOptions(new Date()) as string[];

function day(over: Partial<DayHistoryDto> = {}): DayHistoryDto {
  return {
    date: TODAY as string,
    user: { id: 'u1', name: 'Ravi Kumar', role: 'OT' },
    distanceM: 42_600,
    approx: false,
    startedCount: 2,
    entries: [
      {
        fitmentId: 'f1',
        tkId: 'TK-00012',
        status: 'SUBMITTED',
        customer: 'Acme Logistics',
        site: { name: 'Peenya depot', address: null },
        vehicleRegNo: 'KA01AB1234',
        steps: [
          { kind: 'STARTED', at: '2026-10-12T05:00:00.000Z', label: 'Started' },
          { kind: 'SUBMITTED', at: '2026-10-12T06:34:00.000Z', label: 'Submitted' },
        ],
        legFromPreviousM: null,
        started: true,
      },
      {
        fitmentId: 'f2',
        tkId: 'TK-00013',
        status: 'IN_PROGRESS',
        customer: 'Beta Freight',
        site: { name: 'Hosur yard', address: null },
        vehicleRegNo: null,
        steps: [{ kind: 'STARTED', at: '2026-10-12T08:00:00.000Z', label: 'Started' }],
        legFromPreviousM: 3_200,
        started: true,
      },
    ],
    ...over,
  };
}

const reportees: ReporteesHistoryResponse = {
  date: TODAY as string,
  items: [{ user: { id: 'u7', name: 'Kiran Das', phone: null }, startedCount: 6, distanceM: 42_600, approx: true }],
};

function historyApi(body: (url: URL) => DayHistoryDto = () => day()) {
  return mockFetch((url) => {
    if (url.pathname === '/api/mobile/history') return { status: 200, body: body(url) };
    if (url.pathname === '/api/mobile/history/reportees') return { status: 200, body: reportees };
    return { status: 404 };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedUseSession.mockReturnValue(fakeSession());
});

describe('HistoryScreen', () => {
  it('shows the totals, entries with IST step times and the distance between started entries', async () => {
    historyApi();
    await renderWithProviders(<HistoryScreen />, { date: TODAY });
    expect(await screen.findByTestId('history-totals')).toHaveTextContent('42.6 km · 2 fitments');
    expect(screen.getByText('TK-00012')).toBeOnTheScreen();
    expect(screen.getByText(/Peenya depot · KA01AB1234/)).toBeOnTheScreen();
    expect(screen.getByTestId('step-f1-STARTED')).toHaveTextContent(/10:30\s?am · Started/i);
    expect(screen.getByTestId('step-f1-SUBMITTED')).toHaveTextContent(/12:04\s?pm · Submitted/i);
    expect(screen.queryByTestId('leg-f1')).toBeNull();
    expect(screen.getByTestId('leg-f2')).toHaveTextContent('↓ 3.2 km');
    expect(screen.getByTestId('status-IN_PROGRESS')).toBeOnTheScreen();
    // OT: no tabs
    expect(screen.queryByTestId('tab-reportees')).toBeNull();
    await fireEvent.press(screen.getByTestId('entry-f1'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/fitment/[id]/summary', params: { id: 'f1' } });
  });

  it('marks a straight-line distance as approximate', async () => {
    historyApi(() => day({ approx: true, startedCount: 1 }));
    await renderWithProviders(<HistoryScreen />, { date: TODAY });
    expect(await screen.findByTestId('history-totals')).toHaveTextContent('≈ 42.6 km (approx.) · 1 fitment');
  });

  it('shows the empty state', async () => {
    historyApi(() => day({ entries: [], startedCount: 0, distanceM: 0 }));
    await renderWithProviders(<HistoryScreen />, { date: TODAY });
    expect(await screen.findByText('Nothing done on this day')).toBeOnTheScreen();
  });

  it('refetches with the new date when the header date changes', async () => {
    const fetchMock = historyApi((url) => (url.searchParams.get('date') === THIRD ? day({ distanceM: 5_000 }) : day()));
    await renderWithProviders(<HistoryScreen />, { date: TODAY });
    await screen.findByText(/42.6 km/);
    await fireEvent.press(screen.getByTestId('date-chip'));
    await fireEvent.press(screen.getByTestId(`date-option-${THIRD}`));
    expect(await screen.findByText(/5.0 km/)).toBeOnTheScreen();
    const lastUrl = new URL(fetchMock.mock.calls.at(-1)?.[0] as string);
    expect(lastUrl.searchParams.get('date')).toBe(THIRD);
  });

  it('OE: Personal and Direct reportees tabs; a reportee opens their timeline', async () => {
    mockedUseSession.mockReturnValue(fakeSession({ user: makeUser({ role: 'OE' }) }));
    historyApi();
    await renderWithProviders(<HistoryScreen />, { date: TODAY });
    expect(await screen.findByTestId('history-totals')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('tab-reportees'));
    expect(await screen.findByText('Kiran Das')).toBeOnTheScreen();
    expect(screen.getByText('6 fitments · ≈ 42.6 km (approx.)')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('reportee-u7'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/history/[id]', params: { id: 'u7', name: 'Kiran Das' } });
  });
});

describe('ReporteeHistoryScreen', () => {
  it("shows the reportee's timeline with their name, read only", async () => {
    params.mockReturnValue({ id: 'u7', name: 'Kiran Das' });
    const fetchMock = historyApi(() => day({ user: { id: 'u7', name: 'Kiran Das', role: 'OT' } }));
    await renderWithProviders(<ReporteeHistoryScreen />, { date: TODAY });
    expect(await screen.findByTestId('history-totals')).toBeOnTheScreen();
    expect(screen.getByRole('header')).toHaveTextContent('Kiran Das');
    expect(new URL(fetchMock.mock.calls[0]?.[0] as string).searchParams.get('userId')).toBe('u7');
    await fireEvent.press(screen.getByTestId('entry-f1'));
    expect(router.push).not.toHaveBeenCalled();
  });
});
