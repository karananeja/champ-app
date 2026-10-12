import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { Button } from './ui/button';
import { EmptyState, ErrorState } from './empty-state';
import { ListStates } from './list-states';

// CR-03 / D-085: illustrated empty, no-results and error states.

const illustrationOf = (container: HTMLElement) => container.querySelector('[data-illustration]');

describe('Illustration', () => {
  it('inlines the bundled unDraw SVG, decorative and recoloured through the theme', async () => {
    const { container } = render(<EmptyState illustration="not-found" title="Nothing here" />);
    const art = illustrationOf(container)!;
    expect(art).toHaveAttribute('aria-hidden', 'true');
    expect(art).toHaveAttribute('data-illustration', 'not-found');
    expect(art).toHaveClass('illustration');
    // Loaded lazily; unDraw's accent colour stays in the markup and index.css maps it to the brand primary.
    await waitFor(() => expect(art.querySelector('svg')).not.toBeNull());
    expect(art.querySelector('svg')).toHaveAttribute('viewBox');
    expect(art.querySelector('svg')).not.toHaveAttribute('width');
    expect(art.innerHTML).toContain('#6c63ff');
    expect(art.innerHTML).not.toMatch(/<script|href=/i);
  });
});

describe('EmptyState', () => {
  it('shows an illustration with a heading, text and an optional action', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const { container } = render(
      <EmptyState illustration="empty" title="No clients yet" description="Add one to start." action={<Button onClick={onAdd}>Add client</Button>} />,
    );
    expect(screen.getByRole('heading', { name: 'No clients yet' })).toBeInTheDocument();
    expect(screen.getByText('Add one to start.')).toBeInTheDocument();
    expect(illustrationOf(container)).toHaveAttribute('data-illustration', 'empty');
    await user.click(screen.getByRole('button', { name: 'Add client' }));
    expect(onAdd).toHaveBeenCalled();
  });
});

describe('ErrorState', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    [new ApiError(0, 'NETWORK_ERROR', 'Network error'), "You're offline", 'offline'],
    [new ApiError(403, 'FORBIDDEN', 'No'), "You don't have access", 'access-denied'],
    [new ApiError(404, 'NOT_FOUND', 'Gone'), 'Not found', 'not-found'],
    [new ApiError(500, 'INTERNAL_ERROR', 'Boom'), 'Something went wrong', 'server-error'],
    [new Error('boom'), 'Something went wrong', 'server-error'],
  ] as const)('picks the variant for %s', (error, title, illustration) => {
    const { container } = render(<ErrorState error={error} />);
    expect(screen.getByRole('alert')).toHaveTextContent(title);
    expect(illustrationOf(container)).toHaveAttribute('data-illustration', illustration);
  });

  it('uses the offline variant when the browser is offline, and retries', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const onRetry = vi.fn();
    render(<ErrorState error={new Error('x')} onRetry={onRetry} />);
    expect(screen.getByRole('heading', { name: "You're offline" })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('ListStates', () => {
  const base = { isPending: false, isError: false, isEmpty: false, empty: { title: 'No users yet' } };

  it('shows a skeleton while loading, the list when there are rows', () => {
    const { rerender } = render(
      <ListStates {...base} isPending>
        <p>rows</p>
      </ListStates>,
    );
    expect(screen.getByTestId('list-skeleton')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('rows')).not.toBeInTheDocument();
    rerender(
      <ListStates {...base}>
        <p>rows</p>
      </ListStates>,
    );
    expect(screen.getByText('rows')).toBeInTheDocument();
  });

  it('empty list: the illustrated empty state; with filters: "no matches" with a clear button', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    const { rerender, container } = render(
      <ListStates {...base} isEmpty>
        <p>rows</p>
      </ListStates>,
    );
    expect(screen.getByRole('heading', { name: 'No users yet' })).toBeInTheDocument();
    expect(illustrationOf(container)).toHaveAttribute('data-illustration', 'empty');

    rerender(
      <ListStates {...base} isEmpty filtered onClearFilters={onClear}>
        <p>rows</p>
      </ListStates>,
    );
    expect(screen.getByRole('heading', { name: 'No matches' })).toBeInTheDocument();
    expect(illustrationOf(container)).toHaveAttribute('data-illustration', 'no-results');
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClear).toHaveBeenCalled();
  });

  it('error: the ErrorState with retry', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <ListStates {...base} isError error={new ApiError(500, 'INTERNAL_ERROR', 'x')} onRetry={onRetry}>
        <p>rows</p>
      </ListStates>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });
});
