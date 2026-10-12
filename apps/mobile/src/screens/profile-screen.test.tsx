import { fireEvent, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { useSession } from '../lib/session';
import { fakeSession } from '../test/session-mock';
import { makeUser, renderWithProviders, router } from '../test/utils';
import { ProfileScreen } from './profile-screen';

jest.mock('../lib/session');
const mockedUseSession = jest.mocked(useSession);

describe('ProfileScreen', () => {
  it('shows the profile fields and the home location', async () => {
    mockedUseSession.mockReturnValue(
      fakeSession({
        user: makeUser({ homeLocation: { lat: 12.97, lng: 77.59, address: 'MG Road, Bengaluru', updatedAt: '2026-10-10T05:00:00.000Z' } }),
      }),
    );
    await renderWithProviders(<ProfileScreen />);
    for (const text of ['Ravi Kumar', 'tech@champ.test', 'Field technician', '+91 98450 00001', 'Asha Rao', 'MG Road, Bengaluru']) {
      expect(screen.getByText(text)).toBeOnTheScreen();
    }
    expect(screen.getByText(/Updated .*10.*Oct/)).toBeOnTheScreen();
    expect(screen.getByText(/^Champ v/)).toBeOnTheScreen();
  });

  it('calls the manager with a tel: link', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    mockedUseSession.mockReturnValue(fakeSession());
    await renderWithProviders(<ProfileScreen />);
    await fireEvent.press(screen.getByTestId('manager-phone'));
    expect(open).toHaveBeenCalledWith('tel:+91 98450 00002');
  });

  it('opens the home-location screen in edit mode, and says Not set without one', async () => {
    mockedUseSession.mockReturnValue(fakeSession());
    await renderWithProviders(<ProfileScreen />);
    expect(screen.getByText('Not set')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('change-home'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/onboarding/home-location', params: { mode: 'edit' } });
  });

  it('signs out', async () => {
    const session = fakeSession();
    mockedUseSession.mockReturnValue(session);
    await renderWithProviders(<ProfileScreen />);
    await fireEvent.press(screen.getByTestId('sign-out'));
    expect(session.signOut).toHaveBeenCalled();
  });
});
