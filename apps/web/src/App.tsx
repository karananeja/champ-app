import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { NoAccessRedirect } from '@/components/NoAccessRedirect';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { LoginPage } from '@/features/auth/LoginPage';
import { ClientDetailPage } from '@/features/clients/ClientDetailPage';
import { ClientFormPage } from '@/features/clients/ClientFormPage';
import { ClientsPage } from '@/features/clients/ClientsPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { AcceptInvitePage } from '@/features/invites/AcceptInvitePage';
import { MasterPage } from '@/features/masters/MasterPage';
import { MastersPage } from '@/features/masters/MastersPage';
import { ProfilePage } from '@/features/profile/ProfilePage';
import { BulkUploadPage } from '@/features/tasks/BulkUploadPage';
import { ComingSoonPage } from '@/features/tasks/ComingSoonPage';
import { TaskDetailPage } from '@/features/tasks/TaskDetailPage';
import { TaskFormPage } from '@/features/tasks/TaskFormPage';
import { TaskListPage } from '@/features/tasks/TaskListPage';
import { TechniciansPage } from '@/features/technicians/TechniciansPage';
import { UsersPage } from '@/features/users/UsersPage';
import { useAuth } from '@/lib/auth';
import { RotateCcw, Route as RouteIcon, TriangleAlert } from 'lucide-react';
import {
  canCreateTask,
  canEditClients,
  canViewClients,
  canViewMasters,
  canViewTasks,
  canViewTechnicians,
  canViewUsers,
} from '@/lib/permissions';

function UsersRoute() {
  const { user } = useAuth();
  return user && canViewUsers(user) ? <UsersPage /> : <Navigate to="/" replace />;
}

function TechniciansRoute() {
  const { user } = useAuth();
  return user && canViewTechnicians(user) ? <TechniciansPage /> : <Navigate to="/" replace />;
}

/** Clients pages: SA, OM, OE and RO can view; `edit` pages need SA or OM. OT is sent home. */
function ClientsRoute({ edit = false, children }: { edit?: boolean; children: ReactNode }) {
  const { user } = useAuth();
  const allowed = user && (edit ? canEditClients(user) : canViewClients(user));
  return allowed ? children : <Navigate to="/" replace />;
}

/** Masters pages: SA and OM only (D-059). Others go to the dashboard with a "no access" toast. */
function MastersRoute({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return user && canViewMasters(user) ? children : <NoAccessRedirect />;
}

/**
 * Task pages (F04): SA, OM, OE and RO can view; `create` pages (new, bulk, edit) need a task creator; the
 * Assigned view is for OEs. Others go to the dashboard with a "no access" toast.
 */
function TasksRoute({ create = false, oeOnly = false, children }: { create?: boolean; oeOnly?: boolean; children: ReactNode }) {
  const { user } = useAuth();
  const allowed = user && canViewTasks(user) && (!create || canCreateTask(user)) && (!oeOnly || user.role === 'OE');
  return allowed ? children : <NoAccessRedirect />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="/users" element={<UsersRoute />} />
          <Route path="/technicians" element={<TechniciansRoute />} />
          <Route path="/clients" element={<ClientsRoute><ClientsPage /></ClientsRoute>} />
          <Route path="/clients/new" element={<ClientsRoute edit><ClientFormPage /></ClientsRoute>} />
          <Route path="/clients/:id" element={<ClientsRoute><ClientDetailPage /></ClientsRoute>} />
          <Route path="/clients/:id/edit" element={<ClientsRoute edit><ClientFormPage /></ClientsRoute>} />
          <Route path="/masters" element={<MastersRoute><MastersPage /></MastersRoute>} />
          <Route path="/masters/:slug" element={<MastersRoute><MasterPage /></MastersRoute>} />
          <Route path="/tasks" element={<TasksRoute><TaskListPage view="open" /></TasksRoute>} />
          <Route path="/tasks/assigned" element={<TasksRoute oeOnly><TaskListPage view="assigned" /></TasksRoute>} />
          <Route path="/tasks/new" element={<TasksRoute create><TaskFormPage /></TasksRoute>} />
          <Route path="/tasks/bulk" element={<TasksRoute create><BulkUploadPage /></TasksRoute>} />
          <Route
            path="/tasks/travel"
            element={
              <TasksRoute>
                <ComingSoonPage title="Travel tasks" description="Travel between fitment sites (F08)." icon={RouteIcon} />
              </TasksRoute>
            }
          />
          <Route
            path="/tasks/faulty"
            element={
              <TasksRoute>
                <ComingSoonPage title="Faulty tasks" description="Fitments moved to a faulty task (F05)." icon={TriangleAlert} />
              </TasksRoute>
            }
          />
          <Route
            path="/tasks/reopened"
            element={
              <TasksRoute>
                <ComingSoonPage title="Re-opened" description="Fitments sent back for rework (F05)." icon={RotateCcw} />
              </TasksRoute>
            }
          />
          <Route path="/tasks/:id" element={<TasksRoute><TaskDetailPage /></TasksRoute>} />
          <Route path="/tasks/:id/edit" element={<TasksRoute create><TaskFormPage /></TasksRoute>} />
          <Route path="/profile" element={<ProfilePage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
