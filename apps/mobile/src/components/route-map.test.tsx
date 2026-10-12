import { fireEvent, screen } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { makeRoute } from '../test/route-fixtures';
import { renderWithProviders } from '../test/utils';
import { LOCATE_DENIED_MESSAGE, LOCATE_UNAVAILABLE_MESSAGE, RouteMap } from './route-map';

const permission = jest.mocked(Location.requestForegroundPermissionsAsync);
const position = jest.mocked(Location.getCurrentPositionAsync);

describe('RouteMap: Locate me (CR-07)', () => {
  beforeEach(() => {
    permission.mockReset();
    position.mockReset();
  });

  it('takes a fresh fix and shows where you are', async () => {
    permission.mockResolvedValue({ status: 'granted' } as never);
    position.mockResolvedValue({ coords: { latitude: 12.9757, longitude: 77.605 } } as never);
    await renderWithProviders(<RouteMap route={makeRoute()} />);
    expect(screen.queryByTestId('my-location')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Locate me' }));

    expect(await screen.findByTestId('my-location')).toBeOnTheScreen();
    expect(position).toHaveBeenCalledWith({ accuracy: Location.Accuracy.High });
  });

  it('explains when location access is denied', async () => {
    permission.mockResolvedValue({ status: 'denied' } as never);
    await renderWithProviders(<RouteMap route={makeRoute()} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Locate me' }));

    expect(await screen.findByText(LOCATE_DENIED_MESSAGE)).toBeOnTheScreen();
    expect(position).not.toHaveBeenCalled();
    expect(screen.queryByTestId('my-location')).toBeNull();
  });

  it('explains when no fix arrives', async () => {
    permission.mockResolvedValue({ status: 'granted' } as never);
    position.mockRejectedValue(new Error('no fix'));
    await renderWithProviders(<RouteMap route={makeRoute()} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Locate me' }));

    expect(await screen.findByText(LOCATE_UNAVAILABLE_MESSAGE)).toBeOnTheScreen();
  });
});
