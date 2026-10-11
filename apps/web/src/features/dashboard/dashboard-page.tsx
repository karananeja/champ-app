import { ROLE_LABELS } from '@champ/shared';
import { RoleBadge } from '@/components/role-badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useCurrentUser } from '@/lib/auth';

export function DashboardPage() {
  const user = useCurrentUser();
  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome, {user.name}</h1>
        <RoleBadge role={user.role} full />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Dashboard</CardTitle>
          <CardDescription>
            You are signed in as {ROLE_LABELS[user.role]}. Tasks, clients and reports will appear here as they are
            built.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
