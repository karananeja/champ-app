import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react';
import type { ClientListItemDto } from '@champ/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDebounced } from '@/hooks/use-debounced';
import { useCurrentUser } from '@/lib/auth';
import { canEditClients } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { ActiveBadge } from './active-badge';
import { useClients } from './queries';

const PAGE_SIZE = 20;

type StatusFilter = 'all' | 'active' | 'inactive';
const ACTIVE_PARAM: Record<StatusFilter, 'true' | 'false' | undefined> = {
  all: undefined,
  active: 'true',
  inactive: 'false',
};

const sitesLabel = (c: ClientListItemDto) => `${c.activeSiteCount}/${c.siteCount}`;

/** `/clients`: searchable list of clients (table on desktop, cards on phones). */
export function ClientsPage() {
  const actor = useCurrentUser();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const q = useDebounced(search.trim());
  const { data, isPending, isError } = useClients({ q: q || undefined, active: ACTIVE_PARAM[status], page, pageSize: PAGE_SIZE });
  const clients = data?.items ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
          <p className="text-sm text-muted-foreground">Customers and the sites where fitments happen.</p>
        </div>
        {canEditClients(actor) && (
          <Button asChild>
            <Link to="/clients/new">
              <Plus /> Add client
            </Link>
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:flex">
        <div className="relative sm:flex-1">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search name, code or contact"
            aria-label="Search clients"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-8"
          />
        </div>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v as StatusFilter);
            setPage(1);
          }}
        >
          <SelectTrigger aria-label="Filter by status" className="w-full sm:w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isPending ? (
        <div className="grid grid-cols-1 gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : isError ? (
        <p className="py-8 text-center text-sm text-destructive">Could not load clients.</p>
      ) : clients.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No clients found.</p>
      ) : (
        <>
          {/* Table on md+ */}
          <div className="hidden rounded-md border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Primary contact</TableHead>
                  <TableHead>Sites (active/total)</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.map((client) => (
                  <TableRow
                    key={client.id}
                    data-testid="client-row"
                    data-active={client.active}
                    className={cn(!client.active && 'text-muted-foreground opacity-60')}
                  >
                    <TableCell className="font-medium whitespace-normal">
                      <Link to={`/clients/${client.id}`} className="hover:underline">
                        {client.name}
                      </Link>
                    </TableCell>
                    <TableCell>{client.code ?? '—'}</TableCell>
                    <TableCell className="whitespace-normal">
                      {client.contactName}
                      <div className="text-xs break-all text-muted-foreground">
                        {client.contactPhone}
                        {client.contactEmail && ` · ${client.contactEmail}`}
                      </div>
                    </TableCell>
                    <TableCell>{sitesLabel(client)}</TableCell>
                    <TableCell>
                      <ActiveBadge active={client.active} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {/* Cards on small screens */}
          <ul className="grid grid-cols-1 gap-2 md:hidden">
            {clients.map((client) => (
              <li
                key={client.id}
                data-testid="client-card"
                data-active={client.active}
                className={cn('rounded-md border', !client.active && 'text-muted-foreground opacity-60')}
              >
                <Link to={`/clients/${client.id}`} className="block p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 font-medium break-words">{client.name}</div>
                    {client.code && <span className="shrink-0 font-mono text-xs">{client.code}</span>}
                  </div>
                  <div className="mt-1 truncate text-sm text-muted-foreground">
                    {client.contactName} · {client.contactPhone}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <ActiveBadge active={client.active} />
                    <span className="text-muted-foreground">
                      Sites: <span className="text-foreground">{sitesLabel(client)}</span>
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {page} of {totalPages} · {data.total} clients
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
    </div>
  );
}
