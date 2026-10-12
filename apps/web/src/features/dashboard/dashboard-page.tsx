import { Link } from 'react-router-dom';
import { LayoutDashboard } from 'lucide-react';
import { ROLE_LABELS } from '@champ/shared';
import { ErrorState } from '@/components/empty-state';
import { Illustration } from '@/components/illustration';
import { PageHeader } from '@/components/page-header';
import { RoleBadge } from '@/components/role-badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentUser } from '@/lib/auth';
import { canViewTasks } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { useTaskSummary } from '../tasks/queries';
import { statCardsFor } from './stat-cards';

/** Dashboard (CR-03): a welcome with an illustration and role-aware stat cards that link to their lists. */
export function DashboardPage() {
  const user = useCurrentUser();
  const cards = statCardsFor(user.role);
  const tasksViewer = canViewTasks(user);
  const summary = useTaskSummary(tasksViewer && cards.length > 0);

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        icon={LayoutDashboard}
        title={`Welcome, ${user.name}`}
        description={`Signed in as ${ROLE_LABELS[user.role]}.`}
        actions={<RoleBadge role={user.role} full />}
      />

      <Card className="overflow-hidden py-0">
        <CardContent className="flex flex-col items-center gap-4 p-6 text-center sm:flex-row sm:text-left">
          <Illustration name="dashboard" className="max-w-40 sm:max-w-44" />
          <div className="grid gap-1">
            <h2 className="text-lg font-semibold">
              {tasksViewer ? "Here's what needs attention" : 'Your work happens in the field app'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {tasksViewer
                ? 'The cards below count the lists behind them. Open a card to see the tasks or fitments.'
                : 'Your assigned fitments will appear in the Champ field app. Keep your profile up to date in the meantime.'}
            </p>
          </div>
        </CardContent>
      </Card>

      {cards.length > 0 &&
        (summary.isError ? (
          <ErrorState error={summary.error} size="sm" onRetry={() => void summary.refetch()} />
        ) : (
          <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6" aria-label="Summary" aria-busy={summary.isPending}>
            {cards.map(({ key, label, hint, to, icon: Icon, attention }) => {
              const count = summary.data?.[key];
              const highlight = attention && !!count;
              return (
                <li key={key}>
                  <Link
                    to={to}
                    data-testid={`stat-${key}`}
                    className={cn(
                      'group flex h-full flex-col gap-2 rounded-xl border bg-card p-4 shadow-xs transition-colors hover:border-primary/50 hover:bg-brand-soft/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                      highlight && 'border-primary/40',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-muted-foreground">{label}</span>
                      <span
                        className={cn(
                          'flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground',
                          highlight && 'bg-brand-soft text-brand-soft-foreground',
                        )}
                      >
                        <Icon className="size-4" aria-hidden="true" />
                      </span>
                    </div>
                    {summary.isPending ? (
                      <Skeleton className="h-8 w-12" />
                    ) : (
                      <span className="text-3xl font-semibold tabular-nums" data-testid="stat-count">
                        {count ?? 0}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">{hint}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ))}
    </div>
  );
}
