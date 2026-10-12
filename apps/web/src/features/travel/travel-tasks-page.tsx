import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Download, Loader2, Paperclip, Plus, Route, Search, X } from 'lucide-react';
import {
  TRAVEL_STATUSES,
  TRAVEL_STATUS_LABELS,
  canRaiseTravelOnWeb,
  parseTravelId,
  type ExportFormat,
  type TravelStatus,
  type TravelTaskListItemDto,
} from '@champ/shared';
import { DateRangePicker } from '@/components/date-picker';
import { TravelStatusBadge } from '@/components/fitment-status-badge';
import { ListStates } from '@/components/list-states';
import { PageHeader } from '@/components/page-header';
import { SearchableSelect } from '@/components/searchable-select';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDebounced } from '@/hooks/use-debounced';
import { ApiError } from '@/lib/api';
import { useCurrentUser } from '@/lib/auth';
import { formatDay } from '@/lib/dates';
import { useLookups } from '../masters/queries';
import { downloadFile, useTaskOptions } from '../tasks/queries';
import { useTravelList } from './queries';
import { TravelDetailSheet } from './travel-detail-sheet';
import { TravelFormDialog } from './travel-form-dialog';
import {
  EMPTY_TRAVEL_FILTERS,
  hasTravelFilters,
  travelExportPath,
  travelFiltersFromParams,
  travelQuery,
  withTravelFilters,
  type TravelFilters,
} from './travel-query';

const PAGE_SIZE = 20;
const ALL = 'ALL';

/**
 * The filter bar (CR-04 pattern, D-089): TT id search, technician, OE (hidden for an OE: they only see their
 * technicians'), customer, location, status and travel date range, every control placeholder-only with an
 * `aria-label`, all in the URL.
 */
function TravelFilterBar({ filters, onChange }: { filters: TravelFilters; onChange: (patch: Partial<TravelFilters>) => void }) {
  const actor = useCurrentUser();
  const lookups = useLookups();
  const options = useTaskOptions();
  const [q, setQ] = useState(filters.q);
  const debouncedQ = useDebounced(q);

  // The id search writes to the URL once typing pauses; a URL change (e.g. Clear filters) resets the box.
  useEffect(() => {
    if (debouncedQ.trim() !== filters.q) onChange({ q: debouncedQ });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the typed value settles
  }, [debouncedQ]);
  const [lastUrlQ, setLastUrlQ] = useState(filters.q);
  if (filters.q !== lastUrlQ) {
    setLastUrlQ(filters.q);
    if (filters.q !== q.trim()) setQ(filters.q);
  }
  const notAnId = !!q.trim() && !parseTravelId(q);

  return (
    <div className="grid grid-cols-1 gap-2">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div className="relative col-span-2 lg:col-span-1">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="TT id, e.g. TT-00012" aria-label="Search by TT id" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
        </div>
        <SearchableSelect
          aria-label="Filter by technician"
          className="col-span-2 lg:col-span-1"
          value={filters.technicianId || null}
          onChange={(v) => onChange({ technicianId: v ?? '' })}
          options={(options.data?.technicians ?? []).map((t) => ({ value: t.id, label: t.name, hint: t.baseLocation ?? undefined }))}
          clearLabel="All technicians"
          searchPlaceholder="Search technician"
        />
        {actor.role !== 'OE' && (
          <SearchableSelect
            aria-label="Filter by OE"
            className="col-span-2 lg:col-span-1"
            value={filters.oeId || null}
            onChange={(v) => onChange({ oeId: v ?? '' })}
            options={(options.data?.oes ?? []).map((o) => ({ value: o.id, label: o.name }))}
            clearLabel="All OEs"
            searchPlaceholder="Search OE"
          />
        )}
        <SearchableSelect
          aria-label="Filter by customer"
          className="col-span-2 lg:col-span-1"
          value={filters.clientId || null}
          onChange={(v) => onChange({ clientId: v ?? '' })}
          options={(lookups.data?.clients ?? []).map((c) => ({ value: c.id, label: c.name, hint: c.code ?? undefined }))}
          clearLabel="All customers"
          searchPlaceholder="Search customer"
        />
        <SearchableSelect
          aria-label="Filter by location"
          className="col-span-2 lg:col-span-1"
          value={filters.locationId || null}
          onChange={(v) => onChange({ locationId: v ?? '' })}
          options={(lookups.data?.locations ?? []).map((l) => ({ value: l.id, label: l.city, hint: l.stateName }))}
          clearLabel="All locations"
          searchPlaceholder="Search city"
        />
        <Select value={filters.status || ALL} onValueChange={(v) => onChange({ status: v === ALL ? '' : (v as TravelStatus) })}>
          <SelectTrigger aria-label="Filter by status" className="col-span-2 w-full lg:col-span-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {TRAVEL_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {TRAVEL_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DateRangePicker
          aria-label="Filter by travel date"
          className="col-span-2 lg:col-span-1"
          placeholder="Any travel date"
          value={{ from: filters.from, to: filters.to }}
          onChange={({ from, to }) => onChange({ from, to })}
        />
      </div>
      {(notAnId || hasTravelFilters(filters)) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {notAnId && <span className="text-destructive">Search by a TT id, e.g. TT-00012</span>}
          {hasTravelFilters(filters) && (
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => onChange(EMPTY_TRAVEL_FILTERS)}>
              <X /> Clear filters
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

const distanceText = (t: TravelTaskListItemDto) => (t.distanceKm === null ? '—' : `${t.distanceKm} km`);

function Attachments({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground" title={`${count} receipt(s)`} data-testid="travel-attachments">
      <Paperclip className="size-3.5" aria-hidden />
      {count}
      <span className="sr-only"> receipt(s)</span>
    </span>
  );
}

/**
 * `/tasks/travel` (F08): travel tasks in the caller's scope, filtered through the URL, as a table (cards on
 * phones) with paging, a Download menu (CSV, Excel), the Raise dialog (SA, OM, OE) and the detail sheet
 * (`?tt=<id>`).
 */
export function TravelTasksPage() {
  const actor = useCurrentUser();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = travelFiltersFromParams(searchParams);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const openId = searchParams.get('tt');
  const [raising, setRaising] = useState(false);
  const [downloading, setDownloading] = useState<ExportFormat | null>(null);
  const { data, isPending, isError, error, refetch } = useTravelList({ ...travelQuery(filters), page, pageSize: PAGE_SIZE });
  const items = data?.items ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const canRaise = canRaiseTravelOnWeb(actor);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: key === 'page' });
  };
  const updateFilters = (patch: Partial<TravelFilters>) => setSearchParams(withTravelFilters(searchParams, patch), { replace: true });
  const open = (id: string) => setParam('tt', id);

  const download = async (format: ExportFormat) => {
    setDownloading(format);
    try {
      await downloadFile(travelExportPath(filters, format), `champ-travel-tasks.${format}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not download the travel tasks');
    } finally {
      setDownloading(null);
    }
  };

  const raiseButton = canRaise && (
    <Button onClick={() => setRaising(true)}>
      <Plus /> Raise travel task
    </Button>
  );

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        icon={Route}
        title="Travel tasks"
        description={actor.role === 'OE' ? "Trips of your technicians, for verification and reimbursement." : 'Technicians’ trips outside planned fitments, for verification and reimbursement.'}
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={!!downloading}>
                  {downloading ? <Loader2 className="animate-spin" /> : <Download />} Download
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void download('csv')}>CSV</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void download('xlsx')}>Excel (.xlsx)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {raiseButton}
          </>
        }
      />
      <TravelFilterBar filters={filters} onChange={updateFilters} />

      <ListStates
        isPending={isPending}
        isError={isError}
        error={error}
        onRetry={() => void refetch()}
        isEmpty={items.length === 0}
        filtered={hasTravelFilters(filters)}
        onClearFilters={() => updateFilters(EMPTY_TRAVEL_FILTERS)}
        noMatches={{ title: 'No travel tasks match', description: 'Nothing matches your search or filters. Try other values, or clear the filters.' }}
        empty={{
          illustration: 'travel',
          title: 'No travel tasks yet',
          description: canRaise
            ? 'Record a technician’s trip outside a planned fitment, e.g. picking up a faulty device.'
            : 'Trips raised by operation executives and technicians show here.',
          action: raiseButton,
        }}
      >
        <>
          <div className="hidden rounded-md border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>TT id</TableHead>
                  <TableHead>Travel date</TableHead>
                  <TableHead>Technician</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead>Distance</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((t) => (
                  <TableRow key={t.id} data-testid="travel-row">
                    <TableCell className="font-medium">
                      <Button variant="link" className="h-auto p-0 font-mono" onClick={() => open(t.id)}>
                        {t.ttId}
                      </Button>{' '}
                      <Attachments count={t.attachmentCount} />
                    </TableCell>
                    <TableCell>{formatDay(t.travelDate)}</TableCell>
                    <TableCell className="whitespace-normal">
                      {t.technician.name}
                      {t.oe && <div className="text-xs text-muted-foreground">{t.oe.name}</div>}
                    </TableCell>
                    <TableCell>{t.location.city}</TableCell>
                    <TableCell className="whitespace-normal">{t.client?.name ?? '—'}</TableCell>
                    <TableCell className="max-w-64">
                      <span className="block truncate" title={t.purpose}>
                        {t.purpose}
                      </span>
                      {t.relatedFitment && <div className="font-mono text-xs text-muted-foreground">{t.relatedFitment.tkId}</div>}
                    </TableCell>
                    <TableCell>{distanceText(t)}</TableCell>
                    <TableCell>
                      <TravelStatusBadge status={t.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="grid grid-cols-1 gap-2 md:hidden">
            {items.map((t) => (
              <li key={t.id} data-testid="travel-card" className="rounded-md border">
                <button type="button" className="block w-full p-3 text-left" onClick={() => open(t.id)} aria-label={`Open ${t.ttId}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-mono font-medium">
                        {t.ttId} <Attachments count={t.attachmentCount} />
                      </div>
                      <div className="text-xs text-muted-foreground">{formatDay(t.travelDate)}</div>
                    </div>
                    <TravelStatusBadge status={t.status} />
                  </div>
                  <div className="mt-2 text-sm break-words">
                    {t.technician.name} · {t.location.city}
                    {t.client ? ` · ${t.client.name}` : ''}
                  </div>
                  <div className="line-clamp-2 text-sm break-words text-muted-foreground">{t.purpose}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{distanceText(t)}</div>
                </button>
              </li>
            ))}
          </ul>
        </>
      </ListStates>

      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>
            Page {page} of {totalPages} · {data.total} travel tasks
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setParam('page', String(page - 1))}>
              <ChevronLeft /> Prev
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setParam('page', String(page + 1))}>
              Next <ChevronRight />
            </Button>
          </div>
        </div>
      )}

      {raising && <TravelFormDialog mode={{ kind: 'create' }} onClose={() => setRaising(false)} onSaved={(tt) => open(tt.id)} />}
      {openId && <TravelDetailSheet key={openId} id={openId} onClose={() => setParam('tt', null)} />}
    </div>
  );
}
