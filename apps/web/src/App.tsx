import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { LoginPage } from '@/features/auth/LoginPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { AcceptInvitePage } from '@/features/invites/AcceptInvitePage';
import { ProfilePage } from '@/features/profile/ProfilePage';
import { UsersPage } from '@/features/users/UsersPage';
import { useAuth } from '@/lib/auth';
import { canViewUsers } from '@/lib/permissions';

function UsersRoute() {
  const { user } = useAuth();
  return user && canViewUsers(user) ? <UsersPage /> : <Navigate to="/" replace />;
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
          <Route path="/profile" element={<ProfilePage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
