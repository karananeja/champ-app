import { render, screen } from '@testing-library/react-native';
import { CheckBox } from './checkbox';

// CR-09: a drawn box with a tick when checked (the ☑/☐ glyphs were hard to read in dark mode).
describe('CheckBox', () => {
  it('shows the tick only when checked', async () => {
    await render(<CheckBox checked testID="box" />);
    expect(screen.getByTestId('box-tick')).toBeOnTheScreen();
    await render(<CheckBox checked={false} testID="off" />);
    expect(screen.queryByTestId('off-tick')).toBeNull();
  });
});
