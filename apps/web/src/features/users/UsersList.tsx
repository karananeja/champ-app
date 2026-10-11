import { useState } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { ROLES, ROLE_LABELS, type Role, type UserDto, type UserStatus } from '@champ/shared';
import { RoleBadge } from '@/components/RoleBadge';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDebounced } from '@/hooks/useDebounced';
import { DelegationDialog } from './DelegationDialog';
import { EditUserDialog } from './EditUserDialog';
import { UserActions } from './UserActions';
import { useUsers } from './queries';

const PAGE_SIZE = 20;

export function UsersList({ actor }: { actor: UserDto }) {
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<Role | 'ALL'>('ALL');
  const [status, setStatus] = useState<UserStatus | 'ALL'>('ALL');
  const [page, setPage] = useState(1);
  const q = useDebounced(search.trim());
  const [editId, setEditId] = useState<string | null>(null);
  const [delegationId, setDelegationId] = useState<string | null>(null);

  const { data, isPending, isError } = useUsers({
    q: q || undefined,
    role: role === 'ALL' ? undefined : role,
    status: status === 'ALL' ? undefined : status,
    page,
    pageSize: PAGE_SIZE,
  });
  const users = data?.items ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  // Resolve dialogs from fresh list data so they reflect updates.
  const editUser = users.find((u) => u.id === editId) ?? null;
  const delegationUser = users.find((u) => u.id === delegationId) ?? null;

  const actions = (user: UserDto) => (
    <UserActions
      actor={actor}
      user={user}
      onEdit={(u) => setEditId(u.id)}
      onDelegation={(u) => setDelegationId(u.id)}
    />
  );

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search name or email"
            aria-label="Search users"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-8"
          />
        </div>
        <div className="flex gap-2">
          <Select
            value={role}
            onValueChange={(v) => {
              setRole(v as Role | 'ALL');
              setPage(1);
            }}
          >
            <SelectTrigger aria-label="Filter by role" className="flex-1 sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All roles</SelectItem>
              {ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {ROLE_LABELS[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v as UserStatus | 'ALL');
              setPage(1);
            }}
          >
            <SelectTrigger aria-label="Filter by status" className="flex-1 sm:w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="INACTIVE">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isPending ? (
        <div className="grid grid-cols-1 gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : isError ? (
        <p className="py-8 text-center text-sm text-destructive">Could not load users.</p>
      ) : users.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No users found.</p>
      ) : (
        <>
          {/* Table on md+ */}
          <div className="hidden rounded-md border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Manager</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id} data-testid="user-row">
                    <TableCell className="font-medium whitespace-normal">
                      {user.name}
                      {user.jobTitle && <div className="text-xs text-muted-foreground">{user.jobTitle}</div>}
                    </TableCell>
                    <TableCell className="break-all whitespace-normal">{user.email}</TableCell>
                    <TableCell>
                      <RoleBadge role={user.role} />
                    </TableCell>
                    <TableCell className="whitespace-normal">{user.manager?.name ?? '—'}</TableCell>
                    <TableCell>
                      <StatusBadge status={user.status} />
                    </TableCell>
                    <TableCell>{actions(user)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {/* Cards on small screens */}
          <ul className="grid grid-cols-1 gap-2 md:hidden">
            {users.map((user) => (
              <li key={user.id} className="rounded-md border p-3" data-testid="user-card">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{user.name}</div>
                    <div className="truncate text-sm text-muted-foreground">{user.email}</div>
                  </div>
                  {actions(user)}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                  <RoleBadge role={user.role} />
                  <StatusBadge status={user.status} />
                  {user.manager && <span className="text-muted-foreground">Manager: {user.manager.name}</span>}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {page} of {totalPages} · {data.total} users
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft /> Prev
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight />
            </Button>
          </div>
        </div>
      )}

      <EditUserDialog actor={actor} user={editUser} onOpenChange={(open) => !open && setEditId(null)} />
      <DelegationDialog user={delegationUser} onOpenChange={(open) => !open && setDelegationId(null)} />
    </div>
  );
}
