import { mobileDateOptions } from '@champ/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useSession } from '../lib/session';
import { fakeSession } from '../test/session-mock';
import { makeUser, mockFetch, renderWithProviders, router } from '../test/utils';
import { HomeScreen } from './home-screen';

jest.mock('../lib/session');
const mockedUseSession = jest.mocked(useSession);

// Real clock: the picker is built from today's IST date.
const [TODAY, YESTERDAY, , THIRD, , , , OLDEST] = mobileDateOptions(new Date()) as string[];
const BEFORE_OLDEST = new Date(Date.parse(`${OLDEST}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const TOMORROW = new Date(Date.parse(`${TODAY}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

function homeApi(approveVisit: number | null) {
  return mockFetch((url) =>
    url.pathname === '/api/mobile/home'
      ? { status: 200, body: { date: url.searchParams.get('date'), showTasks: url.searchParams.get('date') === TODAY ? 3 : 5, approveVisit } }
      : { status: 404 },
  );
}

describe('HomeScreen', () => {
  it('shows the Show tasks count, no Approve visit tile for OT, and opens the list', async () => {
    mockedUseSession.mockReturnValue(fakeSession());
    homeApi(null);
    await renderWithProviders(<HomeScreen />, { date: TODAY });
    expect(await screen.findByLabelText('Show tasks, 3')).toBeOnTheScreen();
    expect(screen.queryByTestId('tile-approve-visit')).toBeNull();
    await fireEvent.press(screen.getByTestId('tile-show-tasks'));
    expect(router.push).toHaveBeenCalledWith('/route');
  });

  it('shows the Approve visit count for OE', async () => {
    mockedUseSession.mockReturnValue(fakeSession({ user: makeUser({ role: 'OE' }) }));
    homeApi(2);
    await renderWithProviders(<HomeScreen />, { date: TODAY });
    expect(await screen.findByLabelText('Approve visit, 2')).toBeOnTheScreen();
    expect(screen.getByText('Coming in a later update')).toBeOnTheScreen();
  });

  it('refetches with the new date when the header date changes', async () => {
    mockedUseSession.mockReturnValue(fakeSession());
    const fetchMock = homeApi(null);
    await renderWithProviders(<HomeScreen />, { date: TODAY });
    await screen.findByLabelText('Show tasks, 3');
    await fireEvent.press(screen.getByTestId('date-chip'));
    await fireEvent.press(screen.getByTestId(`date-option-${THIRD}`));
    expect(await screen.findByLabelText('Show tasks, 5')).toBeOnTheScreen();
    const lastUrl = new URL(fetchMock.mock.calls.at(-1)?.[0] as string);
    expect(lastUrl.searchParams.get('date')).toBe(THIRD);
    expect(screen.getByTestId('date-chip')).not.toHaveTextContent(/Today/);
  });

  it('the picker offers only today and the 7 days before it', async () => {
    mockedUseSession.mockReturnValue(fakeSession());
    homeApi(null);
    await renderWithProviders(<HomeScreen />, { date: TODAY });
    await fireEvent.press(screen.getByTestId('date-chip'));
    expect(screen.getByTestId(`date-option-${TODAY}`)).toHaveTextContent('Today');
    expect(screen.getByTestId(`date-option-${YESTERDAY}`)).toHaveTextContent('Yesterday');
    expect(screen.getByTestId(`date-option-${OLDEST}`)).toBeOnTheScreen();
    expect(screen.queryByTestId(`date-option-${BEFORE_OLDEST}`)).toBeNull();
    expect(screen.queryByTestId(`date-option-${TOMORROW}`)).toBeNull();
  });

  it('shows No connection with Retry when the API is unreachable', async () => {
    mockedUseSession.mockReturnValue(fakeSession());
    let online = false;
    mockFetch(() => (online ? { status: 200, body: { date: TODAY, showTasks: 4, approveVisit: null } } : 'network'));
    await renderWithProviders(<HomeScreen />, { date: TODAY });
    expect(await screen.findByText('No connection')).toBeOnTheScreen();
    online = true;
    await fireEvent.press(screen.getByText('Retry'));
    await waitFor(() => expect(screen.getByLabelText('Show tasks, 4')).toBeOnTheScreen());
  });

  it('the bell is disabled and says Coming soon', async () => {
    mockedUseSession.mockReturnValue(fakeSession());
    homeApi(null);
    await renderWithProviders(<HomeScreen />, { date: TODAY });
    expect(screen.getByTestId('bell')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('bell'));
    expect(screen.getByText('Coming soon')).toBeOnTheScreen();
  });
});
