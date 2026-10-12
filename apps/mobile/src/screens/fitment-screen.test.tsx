import type { FitmentAction, FitmentStatus, LookupsResponse } from '@champ/shared';
import { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { useLocalSearchParams } from 'expo-router';
import { Linking } from 'react-native';
import { routeQueryKey } from '../lib/route';
import { makeFitment, makeRoute, makeStop } from '../test/route-fixtures';
import { jsonBody, mockFetch, renderWithProviders, router, type Route } from '../test/utils';
import { FAULTY_TOAST, FitmentScreen, LOCATION_DENIED_MESSAGE, LOCATION_UNAVAILABLE_MESSAGE } from './fitment-screen';

const requestPermission = Location.requestForegroundPermissionsAsync as jest.Mock;
const getPosition = Location.getCurrentPositionAsync as jest.Mock;
const params = useLocalSearchParams as jest.Mock;
const lookups = { closeReasons: [{ id: 'cr1', name: 'Client not available', code: null }, { id: 'cr2', name: 'Device has some issue', code: null }] } as LookupsResponse;

const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();

/** Serves the fitment (status changes after a transition), lookups and the transition itself. */
function serve(opts: { status?: 'ASSIGNED' | 'IN_PROGRESS'; transition?: ReturnType<Route> } = {}) {
  let status: FitmentStatus = opts.status ?? 'ASSIGNED';
  return mockFetch((url, init) => {
    if (url.pathname === '/api/mobile/fitments/f1') {
      const actions: FitmentAction[] = status === 'IN_PROGRESS' ? ['CLOSE_NOT_DONE', 'MARK_FAULTY'] : status === 'ASSIGNED' ? ['START', 'CLOSE_NOT_DONE', 'MARK_FAULTY'] : [];
      return { status: 200, body: makeFitment({ status, availableActions: actions }) };
    }
    if (url.pathname === '/api/lookups') return { status: 200, body: lookups };
    if (url.pathname === '/api/fitments/f1/transitions') {
      const r = opts.transition ?? { status: 200, body: {} };
      if (r !== 'network' && r.status === 200) {
        const action = (jsonBody(init) as { action: string }).action;
        status = action === 'START' ? 'IN_PROGRESS' : action === 'CLOSE_NOT_DONE' ? 'CLOSED_NOT_DONE' : 'MOVED_TO_FT';
      }
      return r;
    }
    return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'nope' } } };
  });
}

const transitionCalls = (fetchMock: jest.Mock) => fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/transitions'));

beforeEach(() => {
  jest.clearAllMocks();
  params.mockReturnValue({ id: 'f1' });
  requestPermission.mockResolvedValue({ status: 'granted' });
  getPosition.mockResolvedValue({ coords: { latitude: 13.031, longitude: 77.521 } });
});

describe('FitmentScreen', () => {
  it('shows the fitment fields, calls the OE and opens Directions', async () => {
    serve();
    await renderWithProviders(<FitmentScreen />);
    expect(await screen.findByText('Acme Logistics')).toBeOnTheScreen();
    for (const text of ['TK-00012', 'Peenya depot', '12 Industrial Rd, Bengaluru', 'KA01AB1234', 'MA1CH4551', 'AS-77', 'New installation', 'Truck', 'Hidden', 'Assigned']) {
      expect(screen.getByText(text)).toBeOnTheScreen();
    }
    expect(screen.getByText(/10:00\s?am IST/i)).toBeOnTheScreen();
    expect(screen.getByText(/Asha Rao/)).toBeOnTheScreen();
    expect(screen.getByTestId('site-map')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('oe-phone'));
    expect(openURL).toHaveBeenCalledWith('tel:+919845000002');
    await fireEvent.press(screen.getByTestId('directions'));
    expect(openURL).toHaveBeenLastCalledWith('http://maps.apple.com/?daddr=13.03,77.52'); // jest-expo runs as iOS
  });

  it('Start with location denied explains why, offers Settings and sends nothing', async () => {
    requestPermission.mockResolvedValue({ status: 'denied' });
    const fetchMock = serve();
    await renderWithProviders(<FitmentScreen />);
    await fireEvent.press(await screen.findByTestId('start'));
    expect(await screen.findByText(LOCATION_DENIED_MESSAGE)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('open-settings'));
    expect(openSettings).toHaveBeenCalled();
    expect(getPosition).not.toHaveBeenCalled();
    expect(transitionCalls(fetchMock)).toHaveLength(0);
  });

  it('Start without a GPS fix explains why and sends nothing', async () => {
    getPosition.mockRejectedValue(new Error('no fix'));
    const fetchMock = serve();
    await renderWithProviders(<FitmentScreen />);
    await fireEvent.press(await screen.findByTestId('start'));
    expect(await screen.findByText(LOCATION_UNAVAILABLE_MESSAGE)).toBeOnTheScreen();
    expect(transitionCalls(fetchMock)).toHaveLength(0);
  });

  it('Start sends START with the fresh fix, then asks Continue or Close; Yes opens the placeholder', async () => {
    const fetchMock = serve();
    await renderWithProviders(<FitmentScreen />);
    await fireEvent.press(await screen.findByTestId('start'));
    expect(await screen.findByTestId('continue-sheet')).toBeOnTheScreen();
    const [call] = transitionCalls(fetchMock);
    expect(call?.[1]?.method).toBe('POST');
    expect(jsonBody(call?.[1] as RequestInit)).toEqual({ action: 'START', payload: { lat: 13.031, lng: 77.521 } });
    expect(getPosition).toHaveBeenCalledWith({ accuracy: Location.Accuracy.High });
    await fireEvent.press(screen.getByTestId('yes-continue'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/fitment/[id]/continue', params: { id: 'f1' } });
  });

  it('the route Start shortcut starts straight away', async () => {
    params.mockReturnValue({ id: 'f1', start: '1' });
    const fetchMock = serve();
    await renderWithProviders(<FitmentScreen />);
    expect(await screen.findByTestId('continue-sheet')).toBeOnTheScreen();
    expect(transitionCalls(fetchMock)).toHaveLength(1);
  });

  it('opening an In-progress fitment asks Continue or Close; No, close validates and sends CLOSE_NOT_DONE', async () => {
    const fetchMock = serve({ status: 'IN_PROGRESS' });
    await renderWithProviders(<FitmentScreen />);
    expect(await screen.findByTestId('continue-sheet')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('no-close'));
    await fireEvent.press(await screen.findByTestId('close-submit'));
    expect(screen.getByText('Choose a close reason')).toBeOnTheScreen();
    expect(screen.getByText('Add comments')).toBeOnTheScreen();
    expect(transitionCalls(fetchMock)).toHaveLength(0);

    await fireEvent.press(await screen.findByTestId('close-reason-cr1'));
    await fireEvent.changeText(screen.getByTestId('close-comments'), '  Gate locked  ');
    await fireEvent.press(screen.getByTestId('close-submit'));
    await waitFor(() => expect(transitionCalls(fetchMock)).toHaveLength(1));
    expect(jsonBody(transitionCalls(fetchMock)[0]?.[1] as RequestInit)).toEqual({
      action: 'CLOSE_NOT_DONE',
      payload: { closeReasonId: 'cr1', comments: 'Gate locked' },
    });
    await waitFor(() => expect(screen.queryByTestId('close-dialog')).toBeNull());
  });

  it('Mark faulty needs a reason, sends MARK_FAULTY and shows the FT toast', async () => {
    const fetchMock = serve();
    await renderWithProviders(<FitmentScreen />);
    await fireEvent.press(await screen.findByTestId('mark-faulty'));
    await fireEvent.press(screen.getByTestId('faulty-submit'));
    expect(screen.getByText('Give the fault reason')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('faulty-reason'), 'x'.repeat(501));
    await fireEvent.press(screen.getByTestId('faulty-submit'));
    expect(screen.getByText('The fault reason must be at most 500 characters')).toBeOnTheScreen();
    expect(transitionCalls(fetchMock)).toHaveLength(0);

    await fireEvent.changeText(screen.getByTestId('faulty-reason'), 'Device dead on arrival');
    await fireEvent.press(screen.getByTestId('faulty-submit'));
    expect(await screen.findByText(FAULTY_TOAST)).toBeOnTheScreen();
    expect(jsonBody(transitionCalls(fetchMock)[0]?.[1] as RequestInit)).toEqual({ action: 'MARK_FAULTY', payload: { reason: 'Device dead on arrival' } });
  });

  it('shows a 409 ROUTE_ORDER message verbatim', async () => {
    serve({ transition: { status: 409, body: { error: { code: 'ROUTE_ORDER', message: 'Finish or close TK-00010 first' } } } });
    await renderWithProviders(<FitmentScreen />);
    await fireEvent.press(await screen.findByTestId('start'));
    expect(await screen.findByTestId('action-error')).toHaveTextContent('Finish or close TK-00010 first');
    expect(screen.queryByTestId('continue-sheet')).toBeNull();
  });

  it('hides Start for a stop that is not next on the cached route', async () => {
    serve();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    client.setQueryData(routeQueryKey('2026-10-12'), makeRoute({ stops: [makeStop({ order: 2, blockedBy: 'TK-00010' })] }));
    await renderWithProviders(<FitmentScreen />, { client });
    expect(await screen.findByText(/Up next after TK-00010/)).toBeOnTheScreen();
    expect(screen.queryByTestId('start')).toBeNull();
    expect(screen.getByTestId('close')).toBeOnTheScreen();
  });
});
