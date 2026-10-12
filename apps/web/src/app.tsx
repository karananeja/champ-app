import type { ReactNode } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/app-shell';
import { NoAccessRedirect } from '@/components/no-access-redirect';
import { ProtectedRoute } from '@/components/protected-route';
import { LoginPage } from '@/features/auth/login-page';
import { ClientDetailPage } from '@/features/clients/client-detail-page';
import { ClientFormPage } from '@/features/clients/client-form-page';
import { ClientsPage } from '@/features/clients/clients-page';
import { DashboardPage } from '@/features/dashboard/dashboard-page';
import { ForbiddenPage, NotFoundPage } from '@/features/errors/error-pages';
import { AcceptInvitePage } from '@/features/invites/accept-invite-page';
import { MasterPage } from '@/features/masters/master-page';
import { MastersPage } from '@/features/masters/masters-page';
import { ProfilePage } from '@/features/profile/profile-page';
import { SearchPage } from '@/features/search/search-page';
import { SearchSettingsPage } from '@/features/search/search-settings-page';
import { BoardPage } from '@/features/tasks/board/board-page';
import { BulkUploadPage } from '@/features/tasks/bulk-upload-page';
import { FitmentListPage } from '@/features/tasks/fitment-list-page';
import { TaskDetailPage } from '@/features/tasks/task-detail-page';
import { TaskFormPage } from '@/features/tasks/task-form-page';
import { TaskListPage } from '@/features/tasks/task-list-page';
import { TechniciansPage } from '@/features/technicians/technicians-page';
import { TravelTasksPage } from '@/features/travel/travel-tasks-page';
import { UsersPage } from '@/features/users/users-page';
import { useAuth } from '@/lib/auth';
import {
  canApproveFitments,
  canCreateTask,
  canUseBoard,
  canEditClients,
  canManageSearchSettings,
  canViewClients,
  canViewMasters,
  canViewTasks,
  canViewTechnicians,
  canViewUsers,
} from '@/lib/permissions';

function UsersRoute() {
  const { user } = useAuth();
  return user && canViewUsers(user) ? <UsersPage /> : <ForbiddenPage />;
}

function TechniciansRoute() {
  const { user } = useAuth();
  return user && canViewTechnicians(user) ? <TechniciansPage /> : <ForbiddenPage />;
}

/** Clients pages: SA, OM, OE and RO can view; `edit` pages need SA or OM. Others get the 403 page (CR-03). */
function ClientsRoute({ edit = false, children }: { edit?: boolean; children: ReactNode }) {
  const { user } = useAuth();
  const allowed = user && (edit ? canEditClients(user) : canViewClients(user));
  return allowed ? children : <ForbiddenPage />;
}

/** Masters pages: SA and OM only (D-059). Others go to the dashboard with a "no access" toast. */
function MastersRoute({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return user && canViewMasters(user) ? children : <NoAccessRedirect />;
}

/**
 * Task pages (F04/F05): SA, OM, OE and RO can view; `create` pages (new, bulk, edit) need a task creator; the
 * Assigned view is for OEs; Awaiting approval (`approver`) for SA/OM. Others go to the dashboard with a
 * "no access" toast.
 */
function TasksRoute({
  create = false,
  oeOnly = false,
  approver = false,
  children,
}: {
  create?: boolean;
  oeOnly?: boolean;
  approver?: boolean;
  children: ReactNode;
}) {
  const { user } = useAuth();
  const allowed =
    user &&
    canViewTasks(user) &&
    (!create || canCreateTask(user)) &&
    (!oeOnly || user.role === 'OE') &&
    (!approver || canApproveFitments(user));
  return allowed ? children : <NoAccessRedirect />;
}

/** Search identifier settings (F14): SA only; others get the 403 page. */
function SearchSettingsRoute() {
  const { user } = useAuth();
  return user && canManageSearchSettings(user) ? <SearchSettingsPage /> : <ForbiddenPage />;
}

/** The board (F07): SA and OM only; others get the 403 page (CR-03). */
function BoardRoute() {
  const { user } = useAuth();
  return user && canUseBoard(user) ? <BoardPage /> : <ForbiddenPage />;
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
          <Route path="/tasks" element={<TasksRoute><TaskListPage key="open" view="open" /></TasksRoute>} />
          <Route path="/tasks/assigned" element={<TasksRoute oeOnly><TaskListPage key="assigned" view="assigned" /></TasksRoute>} />
          <Route path="/tasks/completed" element={<TasksRoute><TaskListPage key="completed" view="completed" /></TasksRoute>} />
          <Route path="/tasks/all" element={<TasksRoute><TaskListPage key="all" view="all" /></TasksRoute>} />
          <Route path="/tasks/board" element={<BoardRoute />} />
          <Route path="/tasks/new" element={<TasksRoute create><TaskFormPage /></TasksRoute>} />
          <Route path="/tasks/bulk" element={<TasksRoute create><BulkUploadPage /></TasksRoute>} />
          <Route path="/tasks/travel" element={<TasksRoute><TravelTasksPage /></TasksRoute>} />
          <Route path="/tasks/awaiting-approval" element={<TasksRoute approver><FitmentListPage key="awaiting-approval" list="awaiting-approval" /></TasksRoute>} />
          <Route path="/tasks/faulty" element={<TasksRoute><FitmentListPage key="faulty" list="faulty" /></TasksRoute>} />
          <Route path="/tasks/reopened" element={<TasksRoute><FitmentListPage key="reopened" list="reopened" /></TasksRoute>} />
          <Route path="/tasks/:id" element={<TasksRoute><TaskDetailPage /></TasksRoute>} />
          <Route path="/tasks/:id/edit" element={<TasksRoute create><TaskFormPage /></TasksRoute>} />
          <Route path="/search" element={<TasksRoute><SearchPage /></TasksRoute>} />
          <Route path="/settings/search" element={<SearchSettingsRoute />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
