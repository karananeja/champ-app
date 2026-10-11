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
import { TechniciansPage } from '@/features/technicians/TechniciansPage';
import { UsersPage } from '@/features/users/UsersPage';
import { useAuth } from '@/lib/auth';
import { canEditClients, canViewClients, canViewMasters, canViewTechnicians, canViewUsers } from '@/lib/permissions';

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
          <Route path="/profile" element={<ProfilePage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
