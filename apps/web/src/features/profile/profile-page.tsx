import type { ReactNode } from 'react';
import { ROLE_LABELS } from '@champ/shared';
import { RoleBadge } from '@/components/role-badge';
import { StatusBadge } from '@/components/status-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCurrentUser } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { UserRound } from 'lucide-react';
import { PageHeader } from '@/components/page-header';

export function ProfilePage() {
  const user = useCurrentUser();
  const rows: [string, ReactNode][] = [
    ['Name', user.name],
    ['Email', user.email],
    ['Phone', user.phone ?? '—'],
    ['Job title', user.jobTitle ?? '—'],
    ['Role', <RoleBadge key="role" role={user.role} full />],
    ['Status', <StatusBadge key="status" status={user.status} />],
    ['Manager', user.manager ? `${user.manager.name}${user.manager.phone ? ` · ${user.manager.phone}` : ''}` : '—'],
    ['Sign-in method', user.authProvider === 'GOOGLE' ? 'Google' : 'Email and password'],
    ['Member since', formatDateTime(user.createdAt)],
  ];
  if (user.role === 'OM') {
    rows.push(
      ['Delegated user management', user.canManageUsers ? 'Yes' : 'No'],
      ['Delegated task types', user.canManageTaskTypes ? 'Yes' : 'No'],
    );
  }

  return (
    <div className="grid max-w-2xl grid-cols-1 gap-6">
      <PageHeader icon={UserRound} title="Profile" description="Your account details." />
      <Card>
        <CardHeader>
          <CardTitle>{user.name}</CardTitle>
          <p className="text-sm text-muted-foreground">{ROLE_LABELS[user.role]}</p>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-[12rem_1fr]">
            {rows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="break-words">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
