import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, RotateCw } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';

const homeButton = (
  <Button asChild>
    <Link to="/">
      <Home /> Go to the dashboard
    </Link>
  </Button>
);

/** 404 for unknown URLs inside the app (CR-03; replaces the silent redirect to the dashboard). */
export function NotFoundPage() {
  const { pathname } = useLocation();
  return (
    <EmptyState
      size="lg"
      illustration="not-found"
      title="Page not found"
      description={
        <>
          There is nothing at <span className="font-mono break-all">{pathname}</span>. Check the link, or start again from
          the dashboard.
        </>
      }
      action={homeButton}
      data-testid="not-found-page"
    />
  );
}

/**
 * 403 for pages your role can't open, where no redirect is used (Users, Technicians, Clients; masters and task
 * pages keep CR-01's redirect with a toast).
 */
export function ForbiddenPage() {
  return (
    <EmptyState
      size="lg"
      illustration="access-denied"
      title="You don't have access"
      description="Your role can't open this page. If you need it, ask a Super Admin or your Operations Manager."
      action={homeButton}
      data-testid="forbidden-page"
    />
  );
}

/** The page shown by the error boundary (500-style). */
export function CrashPage({ onRetry }: { onRetry?: () => void }) {
  return (
    <EmptyState
      size="lg"
      role="alert"
      illustration="server-error"
      title="Something went wrong"
      description="This page hit an unexpected error. Try again; if it keeps happening, tell an admin what you were doing."
      action={
        <>
          <Button variant="outline" onClick={onRetry ?? (() => window.location.reload())}>
            <RotateCw /> Try again
          </Button>
          <Button asChild>
            <a href="/">
              <Home /> Go to the dashboard
            </a>
          </Button>
        </>
      }
      data-testid="crash-page"
    />
  );
}

interface BoundaryProps {
  children: ReactNode;
  /** Changing it (e.g. the path) clears a caught error. */
  resetKey?: string;
}

/** Catches render errors below it and shows the CrashPage instead of a blank screen. */
export class ErrorBoundary extends Component<BoundaryProps, { error: Error | null; key?: string }> {
  state: { error: Error | null; key?: string } = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(props: BoundaryProps, state: { error: Error | null; key?: string }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error', error, info.componentStack);
  }

  render() {
    return this.state.error ? <CrashPage onRetry={() => this.setState({ error: null })} /> : this.props.children;
  }
}
