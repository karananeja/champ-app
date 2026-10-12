import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { makeRoute, makeStop } from '../test/route-fixtures';
import { jsonBody, mockFetch, renderWithProviders, router } from '../test/utils';
import { HOME_ORIGIN_NOTICE, RECALCULATE_NEEDS_GPS, RouteScreen, STRAIGHT_LINE_NOTICE } from './route-screen';

const requestPermission = Location.requestForegroundPermissionsAsync as jest.Mock;
const getPosition = Location.getCurrentPositionAsync as jest.Mock;

const threeStops = makeRoute({
  stops: [
    makeStop({ order: 1, done: true, legFromPrevious: null, fitment: { id: 'f0', tkId: 'TK-00010', status: 'SUBMITTED', availableActions: [] } }),
    makeStop({ order: 2, isNext: true, fitment: { id: 'f1', tkId: 'TK-00012' } }),
    makeStop({ order: 3, blockedBy: 'TK-00012', legFromPrevious: { distanceM: 5050, durationS: 900 }, fitment: { id: 'f2', tkId: 'TK-00013', customer: 'Bharat Freight' } }),
  ],
});

beforeEach(() => {
  jest.clearAllMocks();
  requestPermission.mockResolvedValue({ status: 'granted' });
  getPosition.mockResolvedValue({ coords: { latitude: 12.97, longitude: 77.59 } });
});

describe('RouteScreen', () => {
  it('sends the GPS fix and lists the stops in order with legs, the next highlighted and a blocked label', async () => {
    const fetchMock = mockFetch(() => ({ status: 200, body: threeStops }));
    await renderWithProviders(<RouteScreen />, { date: '2026-10-12' });
    await screen.findByTestId('stop-f1');

    const url = new URL(fetchMock.mock.calls[0]?.[0] as string);
    expect(url.pathname).toBe('/api/mobile/route');
    expect(url.searchParams.get('date')).toBe('2026-10-12');
    expect(url.searchParams.get('lat')).toBe('12.97');
    expect(url.searchParams.get('lng')).toBe('77.59');

    const labels = screen.getAllByLabelText(/^Stop \d/).map((n) => n.props.accessibilityLabel as string);
    expect(labels).toEqual(['Stop 1, TK-00010, Acme Logistics', 'Stop 2, TK-00012, Acme Logistics', 'Stop 3, TK-00013, Bharat Freight']);

    const next = within(screen.getByTestId('stop-f1'));
    expect(next.getByText('Next stop')).toBeOnTheScreen();
    expect(next.getByText('3.4 km · 12 min from previous')).toBeOnTheScreen();
    expect(next.getByText(/10:00\s?am IST/i)).toBeOnTheScreen();
    expect(next.getByText('Assigned')).toBeOnTheScreen();
    expect(screen.getByTestId('blocked-f2')).toHaveTextContent('After TK-00012');
    expect(screen.queryByTestId('start-f2')).toBeNull();
    expect(within(screen.getByTestId('stop-f0')).getByText('Submitted')).toBeOnTheScreen();
    expect(screen.queryByTestId('leg-f0')).toBeNull();
    expect(screen.queryByTestId('notice-home')).toBeNull();
    expect(screen.queryByTestId('notice-straight')).toBeNull();
    expect(screen.getByTestId('route-line')).toBeOnTheScreen();
    expect(screen.getByTestId('origin-GPS')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('stop-f0'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/fitment/[id]/summary', params: { id: 'f0' } });
    await fireEvent.press(screen.getByTestId('stop-f2'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/fitment/[id]', params: { id: 'f2' } });
    await fireEvent.press(screen.getByTestId('start-f1'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/fitment/[id]', params: { id: 'f1', start: '1' } });
  });

  it('without location, asks without coordinates and shows the HOME and straight-line notices', async () => {
    requestPermission.mockResolvedValue({ status: 'denied' });
    const fetchMock = mockFetch(() => ({
      status: 200,
      body: makeRoute({
        origin: { lat: 12.9, lng: 77.6, source: 'HOME' },
        engine: 'STRAIGHT_LINE',
        geometry: null,
        stops: [makeStop({ order: 1, isNext: true, legFromPrevious: { distanceM: 2000, durationS: null } })],
      }),
    }));
    await renderWithProviders(<RouteScreen />, { date: '2026-10-12' });
    expect(await screen.findByText(HOME_ORIGIN_NOTICE)).toBeOnTheScreen();
    expect(screen.getByText(STRAIGHT_LINE_NOTICE)).toBeOnTheScreen();
    expect(screen.getByText('2.0 km from previous')).toBeOnTheScreen();
    expect(screen.getByTestId('origin-HOME')).toBeOnTheScreen();
    // Straight segments from home to the stop.
    expect(screen.getByTestId('route-line')).toBeOnTheScreen();
    const url = new URL(fetchMock.mock.calls[0]?.[0] as string);
    expect(url.searchParams.has('lat')).toBe(false);
    expect(getPosition).not.toHaveBeenCalled();
  });

  it('shows the empty state with an illustration', async () => {
    mockFetch(() => ({ status: 200, body: makeRoute({ origin: null, engine: null, geometry: null, totalDistanceM: 0, stops: [] }) }));
    await renderWithProviders(<RouteScreen />, { date: '2026-10-12' });
    expect(await screen.findByText('No fitments')).toBeOnTheScreen();
    expect(screen.getByTestId('illustration-tasks-empty')).toBeOnTheScreen();
  });

  it('shows No connection when offline', async () => {
    mockFetch(() => 'network');
    await renderWithProviders(<RouteScreen />, { date: '2026-10-12' });
    expect(await screen.findByText('No connection')).toBeOnTheScreen();
  });

  it('recalculate needs GPS and explains why, without calling the API', async () => {
    const fetchMock = mockFetch(() => ({ status: 200, body: threeStops }));
    await renderWithProviders(<RouteScreen />, { date: '2026-10-12' });
    await screen.findByTestId('recalculate');
    requestPermission.mockResolvedValue({ status: 'denied' });
    await fireEvent.press(screen.getByTestId('recalculate'));
    expect(await screen.findByTestId('recalculate-error')).toHaveTextContent(RECALCULATE_NEEDS_GPS);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/recalculate'))).toBe(false);
  });

  it('recalculate posts the fresh fix and shows the new order', async () => {
    let recalculated = false;
    const fetchMock = mockFetch((url) => {
      if (url.pathname === '/api/mobile/route/recalculate') {
        recalculated = true;
        return { status: 200, body: makeRoute({ stops: [makeStop({ order: 1, isNext: true, fitment: { id: 'f2', tkId: 'TK-00013' } }), makeStop({ order: 2, blockedBy: 'TK-00013' })] }) };
      }
      return recalculated
        ? { status: 200, body: makeRoute({ stops: [makeStop({ order: 1, isNext: true, fitment: { id: 'f2', tkId: 'TK-00013' } }), makeStop({ order: 2, blockedBy: 'TK-00013' })] }) }
        : { status: 200, body: threeStops };
    });
    await renderWithProviders(<RouteScreen />, { date: '2026-10-12' });
    await screen.findByTestId('recalculate');
    getPosition.mockResolvedValue({ coords: { latitude: 13.1, longitude: 77.7 } });
    await fireEvent.press(screen.getByTestId('recalculate'));
    await waitFor(() => expect(screen.getByTestId('blocked-f1')).toHaveTextContent('After TK-00013'));
    const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/api/mobile/route/recalculate'));
    expect(call?.[1]?.method).toBe('POST');
    expect(jsonBody(call?.[1] as RequestInit)).toEqual({ date: '2026-10-12', lat: 13.1, lng: 77.7 });
  });

  it('shows Bulk fill on the first stop of each task with two or more of my fitments', async () => {
    const route = makeRoute({
      stops: [
        makeStop({ order: 1, isNext: true, fitment: { id: 'a1', tkId: 'TK-00020', taskId: 'tA', taskFitmentCount: 2 } }),
        makeStop({ order: 2, fitment: { id: 'b1', tkId: 'TK-00030', taskId: 'tB', taskFitmentCount: 1 } }),
        makeStop({ order: 3, fitment: { id: 'a2', tkId: 'TK-00021', taskId: 'tA', taskFitmentCount: 2 } }),
      ],
    });
    mockFetch(() => ({ status: 200, body: route }));
    await renderWithProviders(<RouteScreen />, { date: '2026-10-12' });
    await fireEvent.press(await screen.findByTestId('bulk-fill-a1'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/task/[taskId]/bulk-fill', params: { taskId: 'tA' } });
    expect(screen.queryByTestId('bulk-fill-a2')).toBeNull();
    expect(screen.queryByTestId('bulk-fill-b1')).toBeNull();
  });
});
