import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AuthLayout } from './auth-layout';

// CR-03: sign-in and invite pages use a split screen on desktop and a stacked layout on phones.
describe('AuthLayout', () => {
  it('has an illustration panel (desktop) and an illustration above the form (phones), both decorative', () => {
    const { container } = render(
      <AuthLayout title="Sign in" description="Use your Champ account." illustration="login" tagline="Fitments in one place.">
        <button type="button">Sign in</button>
      </AuthLayout>,
    );
    const aside = screen.getByTestId('auth-aside');
    expect(aside).toHaveClass('hidden', 'lg:flex');
    expect(aside).toHaveTextContent('Fitments in one place.');
    const art = container.querySelectorAll('[data-illustration="login"]');
    expect(art).toHaveLength(2);
    art.forEach((a) => expect(a).toHaveAttribute('aria-hidden', 'true'));
    // The phone illustration sits above the card and hides from lg up.
    expect(art[1]!.parentElement).toHaveClass('lg:hidden');
    expect(screen.getByText('Sign in', { selector: '[data-slot="card-title"]' })).toBeInTheDocument();
  });
});
