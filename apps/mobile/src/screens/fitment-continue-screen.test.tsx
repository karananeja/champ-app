import { fireEvent, screen } from '@testing-library/react-native';
import { renderWithProviders, router } from '../test/utils';
import { FitmentContinueScreen } from './fitment-continue-screen';

describe('FitmentContinueScreen', () => {
  it('says the form arrives with the next update and goes back to the route', async () => {
    await renderWithProviders(<FitmentContinueScreen />);
    expect(screen.getByText('Fitment form coming soon')).toBeOnTheScreen();
    expect(screen.getByText(/arrives with the next update/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('back-to-route'));
    expect(router.dismissTo).toHaveBeenCalledWith('/route');
  });
});
