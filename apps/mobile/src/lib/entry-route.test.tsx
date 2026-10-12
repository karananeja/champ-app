import { render, screen } from '@testing-library/react-native';
import type * as RNModule from 'react-native';
import { Text } from 'react-native';
import Index from '../app/index';
import { fakeSession } from '../test/session-mock';
import { makeUser } from '../test/utils';
import { useSession } from './session';

// The entry route must never redirect to a guarded screen: on a cold launch that left a blank screen (F09 verification).
jest.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => {
    const { Text: RNText } = jest.requireActual<typeof RNModule>('react-native');
    return <RNText>{`redirect:${href}`}</RNText>;
  },
}));
jest.mock('./session');
const mockedUseSession = jest.mocked(useSession);

describe('entry route', () => {
  it.each([
    ['signed-out', false, 'redirect:/sign-in'],
    ['signed-in', false, 'redirect:/home'],
    ['signed-in', true, 'redirect:/onboarding/home-location'],
  ] as const)('%s (needs home %s) → %s', async (status, needsHomeLocation, expected) => {
    mockedUseSession.mockReturnValue(fakeSession({ status, needsHomeLocation, user: status === 'signed-in' ? makeUser() : null }));
    await render(<Index />);
    expect(screen.getByText(expected)).toBeOnTheScreen();
  });

  it.each(['loading', 'offline'] as const)('renders nothing while %s (the root layout draws that state)', async (status) => {
    mockedUseSession.mockReturnValue(fakeSession({ status, user: null }));
    await render(
      <>
        <Text>root</Text>
        <Index />
      </>,
    );
    expect(screen.queryByText(/^redirect:/)).toBeNull();
  });
});
