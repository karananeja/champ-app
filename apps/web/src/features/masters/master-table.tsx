import { useState } from 'react';
import { toast } from 'sonner';
import { Pencil, Plus, Search } from 'lucide-react';
import type { UserDto } from '@champ/shared';
import { SearchableSelect } from '@/components/searchable-select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDebounced } from '@/hooks/use-debounced';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { MasterConfig, MasterRow } from './config';
import { MasterFormDialog } from './master-form-dialog';
import { useLookups, useMasterList, useSaveMaster } from './queries';

type StatusFilter = 'all' | 'active' | 'inactive';

const ACTIVE_PARAM: Record<StatusFilter, string | undefined> = { all: undefined, active: 'true', inactive: 'false' };

interface Props {
  config: MasterConfig;
  actor: UserDto;
}

/** Searchable, filterable list of one master with add/edit and activate/deactivate (when allowed). */
export function MasterTable({ config, actor }: Props) {
  const editable = config.canEdit(actor);
  const lookups = useLookups();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [filters, setFilters] = useState<Record<string, string | undefined>>({});
  const [formTarget, setFormTarget] = useState<MasterRow | 'new' | null>(null);
  const [toggleTarget, setToggleTarget] = useState<MasterRow | null>(null);
  const q = useDebounced(search.trim());

  const { data: rows, isPending, isError } = useMasterList(config, {
    q: q || undefined,
    active: ACTIVE_PARAM[status],
    ...filters,
  });

  const save = useSaveMaster(config);
  const toggle = (row: MasterRow) =>
    save.mutate(
      { id: row.id, body: { active: !row.active } },
      {
        onSuccess: (saved) =>
          toast.success(`${config.label(saved)} ${saved.active ? 'activated' : 'deactivated'}`),
        onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Could not update'),
        onSettled: () => setToggleTarget(null),
      },
    );

  const [first, ...rest] = config.columns;

  const rowActions = (row: MasterRow) => {
    const locked = !!row.isSystem;
    const label = config.label(row);
    return (
      <div className="flex items-center justify-end gap-2">
        <Switch
          checked={row.active}
          disabled={locked}
          onCheckedChange={() => setToggleTarget(row)}
          aria-label={`${row.active ? 'Deactivate' : 'Activate'} ${label}`}
          title={locked ? 'Built-in items cannot be deactivated' : undefined}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={locked}
          onClick={() => setFormTarget(row)}
          aria-label={`Edit ${label}`}
          title={locked ? 'Built-in items cannot be renamed' : undefined}
        >
          <Pencil />
        </Button>
      </div>
    );
  };

  const statusBadge = (row: MasterRow) =>
    row.active ? (
      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
        Active
      </Badge>
    ) : (
      <Badge variant="outline" className="border-neutral-200 bg-neutral-100 text-neutral-600">
        Inactive
      </Badge>
    );

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={config.searchPlaceholder}
            aria-label={config.searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
          {config.filters?.map((filter) => (
            <SearchableSelect
              key={filter.param}
              aria-label={`Filter by ${filter.label.toLowerCase()}`}
              className="sm:w-48"
              value={filters[filter.param] ?? null}
              onChange={(v) => setFilters((f) => ({ ...f, [filter.param]: v ?? undefined }))}
              options={lookups.data ? filter.options(lookups.data) : []}
              clearLabel={filter.allLabel}
              searchPlaceholder={`Search ${filter.label.toLowerCase()}`}
            />
          ))}
          <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
            <SelectTrigger aria-label="Filter by status" className="w-full sm:w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
          {editable && (
            <Button onClick={() => setFormTarget('new')}>
              <Plus /> Add {config.singular.toLowerCase()}
            </Button>
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
        <p className="py-8 text-center text-sm text-destructive">Could not load {config.title.toLowerCase()}.</p>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No {config.title.toLowerCase()} found.</p>
      ) : (
        <>
          {/* Table on md+ */}
          <div className="hidden rounded-md border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  {config.columns.map((c) => (
                    <TableHead key={c.header}>{c.header}</TableHead>
                  ))}
                  <TableHead>Status</TableHead>
                  {editable && (
                    <TableHead className="w-28">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-testid="master-row"
                    data-active={row.active}
                    className={cn(!row.active && 'text-muted-foreground opacity-60')}
                  >
                    {config.columns.map((c, i) => (
                      <TableCell key={c.header} className={cn('whitespace-normal', i === 0 && 'font-medium', c.className)}>
                        {c.cell(row)}
                      </TableCell>
                    ))}
                    <TableCell>{statusBadge(row)}</TableCell>
                    {editable && <TableCell>{rowActions(row)}</TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {/* Cards on small screens */}
          <ul className="grid grid-cols-1 gap-2 md:hidden">
            {rows.map((row) => (
              <li
                key={row.id}
                data-testid="master-card"
                data-active={row.active}
                className={cn('rounded-md border p-3', !row.active && 'text-muted-foreground opacity-60')}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 font-medium break-words">{first!.cell(row)}</div>
                  {editable && rowActions(row)}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  {statusBadge(row)}
                  {rest.map((c) => (
                    <span key={c.header} className="text-muted-foreground">
                      {c.header}: <span className="text-foreground">{c.cell(row)}</span>
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {editable && (
        <>
          <MasterFormDialog config={config} target={formTarget} onOpenChange={(open) => !open && setFormTarget(null)} />
          <AlertDialog open={!!toggleTarget} onOpenChange={(open) => !open && setToggleTarget(null)}>
            <AlertDialogContent>
              {toggleTarget && (
                <>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {toggleTarget.active ? 'Deactivate' : 'Activate'} {config.label(toggleTarget)}?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {toggleTarget.active
                        ? 'It will no longer be offered in dropdowns. Existing records keep it.'
                        : 'It will be offered in dropdowns again.'}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={(e) => {
                        e.preventDefault();
                        toggle(toggleTarget);
                      }}
                      disabled={save.isPending}
                    >
                      {toggleTarget.active ? 'Deactivate' : 'Activate'}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </>
              )}
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}
