import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PasswordInput } from './PasswordInput';

function renderField() {
  render(
    <form>
      <label htmlFor="pw">Password</label>
      <PasswordInput id="pw" />
      <button type="submit">Submit</button>
    </form>,
  );
  return { input: screen.getByLabelText('Password'), user: userEvent.setup() };
}

describe('PasswordInput', () => {
  it('starts hidden and toggles between password and text', async () => {
    const { input, user } = renderField();
    await user.type(input, 'Secret123');
    expect(input).toHaveAttribute('type', 'password');

    const show = screen.getByRole('button', { name: 'Show password' });
    expect(show).toHaveAttribute('type', 'button');
    expect(show).toHaveAttribute('aria-pressed', 'false');
    expect(show.querySelector('[data-icon]')).toHaveAttribute('data-icon', 'eye');

    await user.click(show);
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveValue('Secret123');
    const hide = screen.getByRole('button', { name: 'Hide password' });
    expect(hide).toHaveAttribute('aria-pressed', 'true');
    expect(hide.querySelector('[data-icon]')).toHaveAttribute('data-icon', 'eye-off');

    await user.click(hide);
    expect(input).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Show password' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('does not submit the form and keeps focus in the field', async () => {
    const { input, user } = renderField();
    const form = input.closest('form')!;
    let submitted = false;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submitted = true;
    });
    await user.click(input);
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(submitted).toBe(false);
    expect(input).toHaveFocus();
  });

  it('is not a tab stop between the field and the submit button', async () => {
    const { input, user } = renderField();
    expect(screen.getByRole('button', { name: 'Show password' })).toHaveAttribute('tabindex', '-1');
    await user.click(input);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Submit' })).toHaveFocus();
  });
});
