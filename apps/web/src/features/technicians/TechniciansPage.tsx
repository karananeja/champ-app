import { useState } from 'react';
import { ChevronLeft, ChevronRight, Pencil, Search, UserPlus } from 'lucide-react';
import {
  TECHNICIAN_TYPES,
  TECHNICIAN_TYPE_LABELS,
  type TechnicianDto,
  type TechnicianType,
  type UserDto,
  type UserStatus,
} from '@champ/shared';
import { SearchableSelect } from '@/components/SearchableSelect';
import { StatusBadge } from '@/components/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDebounced } from '@/hooks/useDebounced';
import { useCurrentUser } from '@/lib/auth';
import { canAddTechnician, canManageTechnician } from '@/lib/permissions';
import { useLookups } from '../masters/queries';
import { useUsers } from '../users/queries';
import { TechnicianDialog } from './TechnicianDialog';
import { useTechnicians } from './queries';

const PAGE_SIZE = 20;
const ALL = 'ALL';

const locationLabel = (t: TechnicianDto) => (t.baseLocation ? `${t.baseLocation.city}, ${t.baseLocation.state}` : '—');
const typeLabel = (t: TechnicianDto) => (t.technicianType ? TECHNICIAN_TYPE_LABELS[t.technicianType] : '—');

export function TechniciansPage() {
  const actor = useCurrentUser();
  const isOe = actor.role === 'OE';
  const [search, setSearch] = useState('');
  const [type, setType] = useState<TechnicianType | typeof ALL>(ALL);
  const [baseLocationId, setBaseLocationId] = useState<string | null>(null);
  const [managerId, setManagerId] = useState<string>(ALL);
  const [status, setStatus] = useState<UserStatus | typeof ALL>(ALL);
  const [page, setPage] = useState(1);
  const [dialogTarget, setDialogTarget] = useState<TechnicianDto | 'new' | null>(null);
  const q = useDebounced(search.trim());

  const lookups = useLookups();
  // Reporting OE filter options (an OE only sees their own technicians, so they don't get this filter).
  const oes = useUsers({ role: 'OE', status: 'ACTIVE', pageSize: 100 }, !isOe);
  const { data, isPending, isError } = useTechnicians({
    q: q || undefined,
    type: type === ALL ? undefined : type,
    baseLocationId: baseLocationId ?? undefined,
    managerId: managerId === ALL ? undefined : managerId,
    status: status === ALL ? undefined : status,
    page,
    pageSize: PAGE_SIZE,
  });
  const technicians = data?.items ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const resetPage = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };

  const editButton = (tech: TechnicianDto) =>
    canManageTechnician(actor, tech) ? (
      <Button variant="ghost" size="icon-sm" aria-label={`Edit ${tech.name}`} onClick={() => setDialogTarget(tech)}>
        <Pencil />
      </Button>
    ) : null;

  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Technicians</h1>
          <p className="text-sm text-muted-foreground">
            {isOe ? 'Technicians who report to you.' : 'Every Operations Technician, with type and base location.'}
          </p>
        </div>
        {canAddTechnician(actor) && (
          <Button onClick={() => setDialogTarget('new')}>
            <UserPlus /> Add technician
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 lg:flex lg:flex-wrap">
        <div className="relative lg:min-w-56 lg:flex-1">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search name, email or phone"
            aria-label="Search technicians"
            value={search}
            onChange={(e) => resetPage(setSearch)(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <Select value={type} onValueChange={resetPage((v: string) => setType(v as TechnicianType | typeof ALL))}>
            <SelectTrigger aria-label="Filter by type" className="w-full sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All types</SelectItem>
              {TECHNICIAN_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {TECHNICIAN_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={resetPage((v: string) => setStatus(v as UserStatus | typeof ALL))}>
            <SelectTrigger aria-label="Filter by status" className="w-full sm:w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="INACTIVE">Inactive</SelectItem>
            </SelectContent>
          </Select>
          <SearchableSelect
            aria-label="Filter by base location"
            className="col-span-2 sm:w-52"
            value={baseLocationId}
            onChange={resetPage(setBaseLocationId)}
            options={(lookups.data?.locations ?? []).map((l) => ({
              value: l.id,
              label: `${l.city}, ${l.stateName}`,
            }))}
            clearLabel="All base locations"
            searchPlaceholder="Search city or state"
          />
          {!isOe && (
            <Select value={managerId} onValueChange={resetPage(setManagerId)}>
              <SelectTrigger aria-label="Filter by reporting OE" className="col-span-2 w-full sm:w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All reporting OEs</SelectItem>
                {oes.data?.items.map((oe: UserDto) => (
                  <SelectItem key={oe.id} value={oe.id}>
                    {oe.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {isPending ? (
        <div className="grid grid-cols-1 gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : isError ? (
        <p className="py-8 text-center text-sm text-destructive">Could not load technicians.</p>
      ) : technicians.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No technicians found.</p>
      ) : (
        <>
          {/* Table on md+ */}
          <div className="hidden rounded-md border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Base location</TableHead>
                  <TableHead>Reporting OE</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {technicians.map((tech) => (
                  <TableRow key={tech.id} data-testid="technician-row">
                    <TableCell className="font-medium whitespace-normal">
                      {tech.name}
                      <div className="text-xs font-normal break-all text-muted-foreground">{tech.email}</div>
                    </TableCell>
                    <TableCell>{tech.phone ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{typeLabel(tech)}</Badge>
                    </TableCell>
                    <TableCell className="whitespace-normal">{locationLabel(tech)}</TableCell>
                    <TableCell className="whitespace-normal">{tech.manager?.name ?? '—'}</TableCell>
                    <TableCell>
                      <StatusBadge status={tech.status} />
                    </TableCell>
                    <TableCell>{editButton(tech)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {/* Cards on small screens */}
          <ul className="grid grid-cols-1 gap-2 md:hidden">
            {technicians.map((tech) => (
              <li key={tech.id} className="rounded-md border p-3" data-testid="technician-card">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{tech.name}</div>
                    <div className="truncate text-sm text-muted-foreground">{tech.email}</div>
                    {tech.phone && <div className="truncate text-sm text-muted-foreground">{tech.phone}</div>}
                  </div>
                  {editButton(tech)}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="secondary">{typeLabel(tech)}</Badge>
                  <StatusBadge status={tech.status} />
                  <span className="text-muted-foreground">{locationLabel(tech)}</span>
                  {tech.manager && <span className="text-muted-foreground">OE: {tech.manager.name}</span>}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {page} of {totalPages} · {data.total} technicians
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

      <TechnicianDialog actor={actor} target={dialogTarget} onOpenChange={(open) => !open && setDialogTarget(null)} />
    </div>
  );
}
