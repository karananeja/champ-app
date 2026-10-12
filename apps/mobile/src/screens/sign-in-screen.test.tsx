import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { ApiError, NetworkError } from '../lib/api-client';
import { useSession } from '../lib/session';
import { fakeSession } from '../test/session-mock';
import { renderWithProviders } from '../test/utils';
import { SignInScreen } from './sign-in-screen';

jest.mock('../lib/session');
const mockedUseSession = jest.mocked(useSession);

async function fill(email: string, password: string) {
  await fireEvent.changeText(screen.getByTestId('email'), email);
  await fireEvent.changeText(screen.getByTestId('password'), password);
  await fireEvent.press(screen.getByTestId('sign-in'));
}

describe('SignInScreen', () => {
  it('validates the form before calling the server', async () => {
    const session = fakeSession();
    mockedUseSession.mockReturnValue(session);
    await renderWithProviders(<SignInScreen />);
    await fill('not-an-email', '');
    expect(await screen.findByText('Password is required')).toBeOnTheScreen();
    expect(session.signIn).not.toHaveBeenCalled();
  });

  it('signs in with the typed credentials', async () => {
    const session = fakeSession();
    mockedUseSession.mockReturnValue(session);
    await renderWithProviders(<SignInScreen />);
    await fill('tech@champ.test', 'secret123');
    await waitFor(() => expect(session.signIn).toHaveBeenCalledWith({ email: 'tech@champ.test', password: 'secret123' }));
  });

  it('shows the server message verbatim', async () => {
    mockedUseSession.mockReturnValue(
      fakeSession({ signIn: jest.fn().mockRejectedValue(new ApiError(401, 'INVALID_CREDENTIALS', 'Wrong email or password')) }),
    );
    await renderWithProviders(<SignInScreen />);
    await fill('tech@champ.test', 'bad');
    expect(await screen.findByText('Wrong email or password')).toBeOnTheScreen();
  });

  it('refuses SA/OM/RO with "Use the Champ web console"', async () => {
    mockedUseSession.mockReturnValue(
      fakeSession({ signIn: jest.fn().mockRejectedValue(new ApiError(403, 'MOBILE_ROLE_NOT_ALLOWED', 'Forbidden')) }),
    );
    await renderWithProviders(<SignInScreen />);
    await fill('om@champ.test', 'secret123');
    expect(await screen.findByText('Use the Champ web console')).toBeOnTheScreen();
  });

  it('explains a network failure', async () => {
    mockedUseSession.mockReturnValue(fakeSession({ signIn: jest.fn().mockRejectedValue(new NetworkError()) }));
    await renderWithProviders(<SignInScreen />);
    await fill('tech@champ.test', 'secret123');
    expect(await screen.findByText(/Can't reach the Champ server/)).toBeOnTheScreen();
  });

  it('toggles password visibility', async () => {
    mockedUseSession.mockReturnValue(fakeSession());
    await renderWithProviders(<SignInScreen />);
    expect(screen.getByTestId('password')).toHaveProp('secureTextEntry', true);
    await fireEvent.press(screen.getByLabelText('Show password'));
    expect(screen.getByTestId('password')).toHaveProp('secureTextEntry', false);
  });
});
