import type { ReactNode } from 'react';
import { RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiError, isNetworkError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Illustration, type IllustrationName } from './illustration';

interface EmptyStateProps {
  illustration: IllustrationName;
  title: string;
  description?: ReactNode;
  /** Optional call to action (a Button or a Link styled as one). */
  action?: ReactNode;
  /** `sm` inside cards and tables, `md` for page-level states, `lg` for full pages. */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** Live region role; errors use `alert`. */
  role?: 'status' | 'alert';
  'data-testid'?: string;
}

const SIZES = { sm: 'max-w-36', md: 'max-w-52', lg: 'max-w-72' } as const;

/**
 * An illustration with a clear message and an optional action (CR-03 / D-085), for empty lists, no search or
 * filter matches, and page-level states. The illustration is decorative; the heading and text carry the meaning.
 */
export function EmptyState({
  illustration,
  title,
  description,
  action,
  size = 'md',
  className,
  role = 'status',
  ...rest
}: EmptyStateProps) {
  return (
    <div
      role={role}
      data-testid={rest['data-testid'] ?? 'empty-state'}
      className={cn('flex flex-col items-center gap-3 px-4 py-8 text-center', className)}
    >
      <Illustration name={illustration} className={cn(SIZES[size], 'mb-2')} />
      <h2 className={cn('font-semibold tracking-tight', size === 'lg' ? 'text-2xl' : 'text-base')}>{title}</h2>
      {description && <div className="max-w-md text-sm text-muted-foreground">{description}</div>}
      {action && <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

interface ErrorStateProps {
  /** The failed query's error: picks the offline, 403 or 404 variant. */
  error?: unknown;
  title?: string;
  description?: ReactNode;
  onRetry?: () => void;
  size?: EmptyStateProps['size'];
  className?: string;
  action?: ReactNode;
}

/**
 * The error variant of EmptyState: offline/network, 403, 404 or a generic "something went wrong", with a retry
 * button when given `onRetry`.
 */
export function ErrorState({ error, title, description, onRetry, size = 'md', className, action }: ErrorStateProps) {
  const status = error instanceof ApiError ? error.status : 0;
  const variant: { illustration: IllustrationName; title: string; description: string } = isNetworkError(error)
    ? { illustration: 'offline', title: "You're offline", description: "We couldn't reach Champ. Check your connection and try again." }
    : status === 403
      ? { illustration: 'access-denied', title: "You don't have access", description: 'Your role cannot open this. Ask an admin if you need it.' }
      : status === 404
        ? { illustration: 'not-found', title: 'Not found', description: 'It may have been removed, or the link is wrong.' }
        : { illustration: 'server-error', title: 'Something went wrong', description: 'Please try again. If it keeps happening, tell an admin.' };
  return (
    <EmptyState
      role="alert"
      data-testid="error-state"
      illustration={variant.illustration}
      title={title ?? variant.title}
      description={description ?? variant.description}
      size={size}
      className={className}
      action={
        <>
          {onRetry && (
            <Button variant="outline" onClick={onRetry}>
              <RotateCw /> Try again
            </Button>
          )}
          {action}
        </>
      }
    />
  );
}
