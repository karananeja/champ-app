import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { useLocalSearchParams } from 'expo-router';
import { useSession } from '../lib/session';
import { fakeSession } from '../test/session-mock';
import { jsonBody, makeUser, mockFetch, renderWithProviders, router } from '../test/utils';
import { HomeLocationScreen, PERMISSION_DENIED_MESSAGE } from './home-location-screen';

jest.mock('../lib/session');
const mockedUseSession = jest.mocked(useSession);
const location = jest.mocked(Location);

beforeEach(() => {
  jest.mocked(useLocalSearchParams).mockReturnValue({});
  router.replace?.mockClear();
});

function geoApi(onSave?: (body: unknown) => void) {
  return mockFetch((url, init) => {
    if (url.pathname === '/api/geo/reverse') return { status: 200, body: { item: { displayName: 'Koramangala, Bengaluru', lat: 12.93, lng: 77.62 } } };
    if (url.pathname === '/api/geo/search') return { status: 200, body: { items: [{ displayName: 'Indiranagar, Bengaluru', lat: 12.97, lng: 77.64 }] } };
    if (url.pathname === '/api/me/home-location') {
      onSave?.(jsonBody(init));
      const b = jsonBody(init) as { lat: number; lng: number; address: string };
      return { status: 200, body: makeUser({ homeLocation: { ...b, updatedAt: '2026-10-12T05:00:00.000Z' } }) };
    }
    return { status: 404 };
  });
}

describe('HomeLocationScreen', () => {
  it('OT cannot skip', async () => {
    mockedUseSession.mockReturnValue(fakeSession());
    geoApi();
    await renderWithProviders(<HomeLocationScreen />);
    expect(screen.queryByTestId('skip')).toBeNull();
  });

  it('OE can skip', async () => {
    const session = fakeSession({ user: makeUser({ role: 'OE' }) });
    mockedUseSession.mockReturnValue(session);
    geoApi();
    await renderWithProviders(<HomeLocationScreen />);
    await fireEvent.press(screen.getByTestId('skip'));
    expect(session.skipHomeLocation).toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/home');
  });

  it('uses GPS, fills the address from the pin and saves lat, lng and address', async () => {
    location.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);
    location.getCurrentPositionAsync.mockResolvedValue({ coords: { latitude: 12.93, longitude: 77.62 } } as never);
    const session = fakeSession();
    mockedUseSession.mockReturnValue(session);
    const saved = jest.fn();
    geoApi(saved);
    await renderWithProviders(<HomeLocationScreen />);
    await fireEvent.press(screen.getByTestId('use-gps'));
    await waitFor(() => expect(screen.getByTestId('address')).toHaveDisplayValue('Koramangala, Bengaluru'));
    await fireEvent.press(screen.getByTestId('save'));
    await waitFor(() => expect(saved).toHaveBeenCalledWith({ lat: 12.93, lng: 77.62, address: 'Koramangala, Bengaluru' }));
    await waitFor(() => expect(session.setUser).toHaveBeenCalled());
    expect(router.replace).toHaveBeenCalledWith('/home');
  });

  it('search picks an address and moves the pin', async () => {
    mockedUseSession.mockReturnValue(fakeSession());
    const saved = jest.fn();
    geoApi(saved);
    await renderWithProviders(<HomeLocationScreen />);
    await fireEvent.changeText(screen.getByTestId('address-search'), 'Indira');
    await fireEvent.press(await screen.findByText('Indiranagar, Bengaluru'));
    expect(screen.getByTestId('address')).toHaveDisplayValue('Indiranagar, Bengaluru');
    await fireEvent.press(screen.getByTestId('save'));
    await waitFor(() => expect(saved).toHaveBeenCalledWith({ lat: 12.97, lng: 77.64, address: 'Indiranagar, Bengaluru' }));
  });

  it('explains a denied location permission', async () => {
    location.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never);
    mockedUseSession.mockReturnValue(fakeSession());
    geoApi();
    await renderWithProviders(<HomeLocationScreen />);
    await fireEvent.press(screen.getByTestId('use-gps'));
    expect(await screen.findByText(PERMISSION_DENIED_MESSAGE)).toBeOnTheScreen();
    expect(screen.getByText('Open Settings')).toBeOnTheScreen();
  });

  it('in edit mode, has no Skip and goes back after saving', async () => {
    jest.mocked(useLocalSearchParams).mockReturnValue({ mode: 'edit' });
    mockedUseSession.mockReturnValue(
      fakeSession({ user: makeUser({ role: 'OE', homeLocation: { lat: 12.9, lng: 77.6, address: 'Old home', updatedAt: '2026-10-01T00:00:00Z' } }) }),
    );
    geoApi();
    await renderWithProviders(<HomeLocationScreen />);
    expect(screen.queryByTestId('skip')).toBeNull();
    expect(screen.getByTestId('address')).toHaveDisplayValue('Old home');
    await fireEvent.press(screen.getByTestId('save'));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });
});
