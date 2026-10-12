import { Link } from 'react-router-dom';
import { Plus, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCurrentUser } from '@/lib/auth';
import { canCreateTask } from '@/lib/permissions';
import type { TaskListView } from './task-query';
import { TaskTable } from './task-table';

const COPY: Record<TaskListView, { title: string; description: string }> = {
  open: { title: 'Open tasks', description: 'Every task that is not finished yet.' },
  assigned: { title: 'Assigned to me', description: 'Tasks where you are the operation executive.' },
  completed: { title: 'Completed tasks', description: 'Every finished task, latest completion first.' },
  all: { title: 'All tasks', description: 'Every task, whatever its status.' },
};

/** `/tasks` (Open tasks), `/tasks/assigned` (an OE's own tasks), `/tasks/completed` and `/tasks/all` (CR-04). */
export function TaskListPage({ view }: { view: TaskListView }) {
  const actor = useCurrentUser();
  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{COPY[view].title}</h1>
          <p className="text-sm text-muted-foreground">{COPY[view].description}</p>
        </div>
        {canCreateTask(actor) && (
          <div className="flex flex-wrap gap-2">
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
          </div>
        )}
      </div>
      <TaskTable key={view} view={view} />
    </div>
  );
}
