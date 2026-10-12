import { Link } from 'react-router-dom';
import { CircleCheckBig, ClipboardList, ListTodo, Plus, Upload, UserCheck, type LucideIcon } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { useCurrentUser } from '@/lib/auth';
import { canCreateTask } from '@/lib/permissions';
import type { TaskListView } from './task-query';
import { TaskTable } from './task-table';

const COPY: Record<TaskListView, { title: string; description: string; icon: LucideIcon }> = {
  open: { title: 'Open tasks', description: 'Every task that is not finished yet.', icon: ClipboardList },
  assigned: { title: 'Assigned to me', description: 'Tasks where you are the operation executive.', icon: UserCheck },
  completed: { title: 'Completed tasks', description: 'Every finished task, latest completion first.', icon: CircleCheckBig },
  all: { title: 'All tasks', description: 'Every task, whatever its status.', icon: ListTodo },
};

/** `/tasks` (Open tasks), `/tasks/assigned` (an OE's own tasks), `/tasks/completed` and `/tasks/all` (CR-04). */
export function TaskListPage({ view }: { view: TaskListView }) {
  const actor = useCurrentUser();
  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        icon={COPY[view].icon}
        title={COPY[view].title}
        description={COPY[view].description}
        actions={
          canCreateTask(actor) && (
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
      <TaskTable key={view} view={view} />
    </div>
  );
}
