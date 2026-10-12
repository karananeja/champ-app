import { fireEvent, screen } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { Text } from 'react-native';
import { useSession } from '../lib/session';
import { ProfileScreen } from '../screens/profile-screen';
import { fakeSession } from '../test/session-mock';
import { renderWithProviders } from '../test/utils';
import { DARK, LIGHT } from './colors';
import { loadThemePreference, setThemePreference } from './theme-preference';
import { useTheme } from './use-theme';

// CR-09: System / Light / Dark on the Profile screen drives the palette and is remembered on the phone.
jest.mock('../lib/session');
const mockedUseSession = jest.mocked(useSession);

function Probe() {
  const { dark, colors } = useTheme();
  return <Text testID="probe">{`${dark ? 'dark' : 'light'}:${colors.background}`}</Text>;
}

describe('theme preference', () => {
  afterEach(() => setThemePreference('system'));

  it('the Profile picker switches the palette and saves the choice; System clears it', async () => {
    mockedUseSession.mockReturnValue(fakeSession());
    await renderWithProviders(
      <>
        <ProfileScreen />
        <Probe />
      </>,
    );
    expect(screen.getByTestId('theme-system').props.accessibilityState).toMatchObject({ selected: true });

    await fireEvent.press(screen.getByTestId('theme-dark'));
    expect(screen.getByTestId('probe')).toHaveTextContent(`dark:${DARK.background}`);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('champ.theme', 'dark');
    expect(screen.getByTestId('theme-dark').props.accessibilityState).toMatchObject({ selected: true });

    await fireEvent.press(screen.getByTestId('theme-light'));
    expect(screen.getByTestId('probe')).toHaveTextContent(`light:${LIGHT.background}`);

    await fireEvent.press(screen.getByTestId('theme-system'));
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('champ.theme');
  });

  it('loads the saved choice at startup', async () => {
    await SecureStore.setItemAsync('champ.theme', 'dark');
    await loadThemePreference();
    await renderWithProviders(<Probe />);
    expect(screen.getByTestId('probe')).toHaveTextContent(`dark:${DARK.background}`);
  });
});
