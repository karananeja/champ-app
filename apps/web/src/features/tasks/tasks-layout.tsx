import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { ClipboardList, Plus, Upload } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { useCurrentUser } from '@/lib/auth';
import { canCreateTask, canViewTasks } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { taskTabsFor } from './task-tabs';

/**
 * CR-10: the Tasks page. One header (with Create task / Bulk upload for creators, on the Open tab only) and a tab bar
 * of links, one per task view; the active view renders below. The tab bar scrolls sideways inside itself on narrow
 * screens (`data-scroll-x`).
 */
export function TasksLayout() {
  const user = useCurrentUser();
  const { pathname } = useLocation();
  // The route guard of the view sends users without task access away; render nothing around it.
  if (!canViewTasks(user)) return <Outlet />;
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <PageHeader
        icon={ClipboardList}
        title="Tasks"
        actions={
          canCreateTask(user) &&
          pathname === '/tasks' && (
            <>
              <Button asChild variant="outline">
                <Link to="/tasks/bulk">
                  <Upload /> Bulk upload
                </Link>
              </Button>
              <Button asChild>
                <Link to="/tasks/new">
                  <Plus /> Create task
                </Link>
              </Button>
            </>
          )
        }
      />
      <nav aria-label="Task views" className="-mx-4 min-w-0 overflow-x-auto px-4 md:mx-0 md:px-0" data-testid="task-tabs" data-scroll-x>
        <div className="flex w-max min-w-full gap-1 border-b">
          {taskTabsFor(user).map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end
              className={({ isActive }) =>
                cn(
                  '-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
                  isActive
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
                )
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </div>
      </nav>
      <Outlet />
    </div>
  );
}
