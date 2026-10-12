import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Checkbox } from './checkbox';

// CR-09: in dark mode `dark:bg-input/30` used to win over the checked fill, so a ticked box looked empty.
describe('Checkbox', () => {
  it('keeps the primary fill when checked in dark mode', () => {
    render(<Checkbox checked aria-label="Pick" />);
    const box = screen.getByRole('checkbox', { name: 'Pick' });
    expect(box).toHaveAttribute('data-state', 'checked');
    expect(box.className).toContain('dark:data-[state=checked]:bg-primary');
  });
});
