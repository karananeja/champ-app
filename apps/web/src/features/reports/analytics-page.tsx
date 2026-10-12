import { useState, type ReactNode } from 'react';
import { ChartColumn, X } from 'lucide-react';
import { FITMENT_STATUS_LABELS, type AnalyticsResponse, type OeKpiRow, type TechnicianKpiRow, type WeeklyPoint } from '@champ/shared';
import { DateRangePicker } from '@/components/date-picker';
import { EmptyState, ErrorState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { SearchableSelect } from '@/components/searchable-select';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentUser } from '@/lib/auth';
import { useLookups } from '../masters/queries';
import { useTaskOptions } from '../tasks/queries';
import { BarList, Sparkline, type SparkPoint } from './charts';
import { DownloadButton } from './download-button';
import { KpiTable, type KpiColumn } from './kpi-table';
import { useAnalytics } from './queries';
import { formatHours, formatKm, formatNumber, formatRate, formatShortDay, thisMonthRange } from './report-utils';

interface Filters {
  from: string;
  to: string;
  clientId: string | null;
  oeId: string | null;
  regionId: string | null;
}

/** The analytics query; unset filters are left out. */
const buildAnalyticsQuery = (f: Filters) => ({
  from: f.from,
  to: f.to,
  clientId: f.clientId ?? undefined,
  oeId: f.oeId ?? undefined,
  regionId: f.regionId ?? undefined,
});

const series = (weekly: WeeklyPoint[], key: keyof Omit<WeeklyPoint, 'weekStart'>): SparkPoint[] =>
  weekly.map((w) => ({ label: `Week of ${formatShortDay(w.weekStart)}`, value: w[key] }));

/** A KPI tile: label, headline value, a detail line and a weekly trend. */
function Tile({ label, value, detail, trend, testId }: { label: string; value: ReactNode; detail?: ReactNode; trend?: ReactNode; testId: string }) {
  return (
    <Card className="gap-2 p-4" data-testid={testId}>
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold" data-testid="kpi-value">
        {value}
      </span>
      {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
      {trend}
    </Card>
  );
}

const TECHNICIAN_COLUMNS: KpiColumn<TechnicianKpiRow>[] = [
  { key: 'name', header: 'Technician', value: (r) => r.user.name, cell: (r) => r.user.name },
  { key: 'started', header: 'Started', value: (r) => r.started, cell: (r) => r.started, numeric: true },
  { key: 'submitted', header: 'Submitted', value: (r) => r.submitted, cell: (r) => r.submitted, numeric: true },
  { key: 'workingDays', header: 'Working days', value: (r) => r.workingDays, cell: (r) => r.workingDays, numeric: true },
  { key: 'perDay', header: 'Per day', value: (r) => r.fitmentsPerDay, cell: (r) => formatNumber(r.fitmentsPerDay), numeric: true },
  { key: 'reopens', header: 'Reopens', value: (r) => r.reopens, cell: (r) => r.reopens, numeric: true },
  { key: 'reopenRate', header: 'Reopen rate', value: (r) => r.reopenRate, cell: (r) => formatRate(r.reopenRate), numeric: true },
  { key: 'movedToFt', header: 'Moved to FT', value: (r) => r.movedToFt, cell: (r) => r.movedToFt, numeric: true },
  { key: 'faultyRate', header: 'Faulty rate', value: (r) => r.faultyRate, cell: (r) => formatRate(r.faultyRate), numeric: true },
  { key: 'km', header: 'Km', value: (r) => r.km, cell: (r) => formatKm(r.km, r.kmApprox), numeric: true },
  { key: 'tatMedian', header: 'TAT median', value: (r) => r.fieldTat.medianHours, cell: (r) => formatHours(r.fieldTat.medianHours), numeric: true },
  { key: 'tatP90', header: 'TAT P90', value: (r) => r.fieldTat.p90Hours, cell: (r) => formatHours(r.fieldTat.p90Hours), numeric: true },
];

const OE_COLUMNS: KpiColumn<OeKpiRow>[] = [
  { key: 'name', header: 'OE', value: (r) => r.user.name, cell: (r) => r.user.name },
  { key: 'verified', header: 'Verified', value: (r) => r.verified, cell: (r) => r.verified, numeric: true },
  { key: 'reopens', header: 'Reopens', value: (r) => r.reopens, cell: (r) => r.reopens, numeric: true },
  { key: 'reopenRate', header: 'Reopen rate', value: (r) => r.reopenRate, cell: (r) => formatRate(r.reopenRate), numeric: true },
  { key: 'tatMedian', header: 'End-to-end median', value: (r) => r.endToEndTat.medianHours, cell: (r) => formatHours(r.endToEndTat.medianHours), numeric: true },
  { key: 'tatP90', header: 'End-to-end P90', value: (r) => r.endToEndTat.p90Hours, cell: (r) => formatHours(r.endToEndTat.p90Hours), numeric: true },
];

function Tiles({ data }: { data: AnalyticsResponse }) {
  const { turnaround: tat, reopenRate, fitmentsPerTechnicianPerDay: perDay, faultyRate, km, weekly } = data;
  const trend = (key: keyof Omit<WeeklyPoint, 'weekStart'>, label: string, format?: (v: number) => string) => (
    <div className="mt-auto grid gap-0.5 pt-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Sparkline points={series(weekly, key)} label={label} format={format} />
    </div>
  );
  return (
    <section aria-label="Key figures" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <Card className="gap-2 p-4 sm:row-span-2" data-testid="kpi-status">
        <span className="text-sm font-medium text-muted-foreground">Fitments by status</span>
        <span className="text-xs text-muted-foreground">Fitments dated in the range, by current status</span>
        <BarList label="Fitments by status" data={data.statusCounts.map((s) => ({ key: s.status, label: FITMENT_STATUS_LABELS[s.status], value: s.count }))} />
      </Card>
      <Tile
        testId="kpi-field-tat"
        label="Field turnaround (assigned → submitted)"
        value={`${formatHours(tat.field.medianHours)} median`}
        detail={`P90 ${formatHours(tat.field.p90Hours)} · ${tat.field.count} submissions`}
        trend={trend('submitted', 'Submitted per week')}
      />
      <Tile
        testId="kpi-end-to-end"
        label="End-to-end (created → final approval)"
        value={`${formatHours(tat.endToEnd.medianHours)} median`}
        detail={`P90 ${formatHours(tat.endToEnd.p90Hours)} · ${tat.endToEnd.count} approvals`}
        trend={trend('approved', 'Approved per week')}
      />
      <Tile
        testId="kpi-reopen-rate"
        label="Reopen rate"
        value={formatRate(reopenRate.rate)}
        detail={`${reopenRate.reopens} reopens of ${reopenRate.submitted} submitted`}
        trend={trend('reopens', 'Reopens per week')}
      />
      <Tile
        testId="kpi-per-day"
        label="Fitments per technician per day"
        value={formatNumber(perDay.average)}
        detail={`${perDay.submitted} submitted over ${perDay.technicianDays} technician-days`}
        trend={trend('started', 'Started per week')}
      />
      <Tile
        testId="kpi-faulty-rate"
        label="Faulty rate"
        value={formatRate(faultyRate.rate)}
        detail={`${faultyRate.movedToFt} moved to FT of ${faultyRate.started} started`}
        trend={trend('movedToFt', 'Moved to FT per week')}
      />
      <Tile
        testId="kpi-km"
        label="Distance travelled"
        value={formatKm(km.total, km.approx)}
        detail={km.approx ? '≈ some days are straight-line estimates' : 'Routed day distances'}
        trend={trend('km', 'Km per week', (v) => formatNumber(v))}
      />
    </section>
  );
}

const csvName = (table: string, from: string, to: string) => `analytics-${table}-${from}-to-${to}.csv`;

/** Operations analytics (F15, D-265): KPI tiles with weekly trends and per-technician / per-OE tables. */
export function AnalyticsPage() {
  const actor = useCurrentUser();
  const isOe = actor.role === 'OE';
  const initial: Filters = { ...thisMonthRange(), clientId: null, oeId: null, regionId: null };
  const [filters, setFilters] = useState<Filters>(initial);
  const lookups = useLookups();
  const options = useTaskOptions();
  const rangeComplete = !!filters.from && !!filters.to;
  const query = buildAnalyticsQuery(filters);
  const { data, isPending, isError, error, refetch } = useAnalytics(query, rangeComplete);
  const hasFilters = !!(filters.clientId || filters.oeId || filters.regionId || filters.from !== initial.from || filters.to !== initial.to);
  const update = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((prev) => ({ ...prev, [key]: value }));
  const nothing = data && data.statusCounts.every((s) => s.count === 0) && data.technicians.length === 0 && data.oes.every((o) => o.verified === 0 && o.reopens === 0);

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader icon={ChartColumn} title="Analytics" description={isOe ? 'Your tasks and your technicians.' : 'Fitment turnaround, quality and output.'} />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <DateRangePicker
          aria-label="Date range"
          className="col-span-2 lg:col-span-1"
          clearable={false}
          value={{ from: filters.from, to: filters.to }}
          onChange={({ from, to }) => setFilters((prev) => ({ ...prev, from, to }))}
        />
        <SearchableSelect
          aria-label="Filter by customer"
          className="col-span-2 lg:col-span-1"
          value={filters.clientId}
          onChange={(v) => update('clientId', v)}
          options={(lookups.data?.clients ?? []).map((c) => ({ value: c.id, label: c.name, hint: c.code ?? undefined }))}
          clearLabel="All customers"
          searchPlaceholder="Search customer"
        />
        {!isOe && (
          <SearchableSelect
            aria-label="Filter by OE"
            className="col-span-2 lg:col-span-1"
            value={filters.oeId}
            onChange={(v) => update('oeId', v)}
            options={(options.data?.oes ?? []).map((o) => ({ value: o.id, label: o.name }))}
            clearLabel="All OEs"
            searchPlaceholder="Search OE"
          />
        )}
        <SearchableSelect
          aria-label="Filter by region"
          className="col-span-2 lg:col-span-1"
          value={filters.regionId}
          onChange={(v) => update('regionId', v)}
          options={(lookups.data?.regions ?? []).map((r) => ({ value: r.id, label: r.name }))}
          clearLabel="All regions"
          searchPlaceholder="Search region"
        />
        {hasFilters && (
          <Button variant="ghost" className="col-span-2 justify-self-start lg:col-span-1" onClick={() => setFilters(initial)}>
            <X /> Reset filters
          </Button>
        )}
      </div>

      {!rangeComplete ? (
        <p className="text-sm text-muted-foreground">Pick the last day of the range.</p>
      ) : isPending ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState error={error} size="sm" onRetry={() => void refetch()} />
      ) : nothing ? (
        <EmptyState size="sm" illustration="empty" title="No activity in this range" description="Nothing was dated, started or submitted. Try a wider range or other filters." />
      ) : (
        data && (
          <>
            <Tiles data={data} />
            <section className="grid grid-cols-1 gap-3" aria-labelledby="technicians-heading">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="technicians-heading" className="text-lg font-semibold">
                  Technicians
                </h2>
                <DownloadButton
                  path="/reports/analytics"
                  query={{ ...query, format: 'csv', table: 'technicians' }}
                  fallbackName={csvName('technicians', filters.from, filters.to)}
                  disabled={!data.technicians.length}
                >
                  Download CSV
                </DownloadButton>
              </div>
              {data.technicians.length ? (
                <KpiTable label="Technicians" testId="technician" rows={data.technicians} columns={TECHNICIAN_COLUMNS} rowKey={(r) => r.user.id} />
              ) : (
                <p className="text-sm text-muted-foreground">No technician activity in this range.</p>
              )}
            </section>
            <section className="grid grid-cols-1 gap-3" aria-labelledby="oes-heading">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="oes-heading" className="text-lg font-semibold">
                  OEs
                </h2>
                <DownloadButton
                  path="/reports/analytics"
                  query={{ ...query, format: 'csv', table: 'oes' }}
                  fallbackName={csvName('oes', filters.from, filters.to)}
                  disabled={!data.oes.length}
                >
                  Download CSV
                </DownloadButton>
              </div>
              {data.oes.length ? (
                <KpiTable label="OEs" testId="oe" rows={data.oes} columns={OE_COLUMNS} rowKey={(r) => r.user.id} />
              ) : (
                <p className="text-sm text-muted-foreground">No OE activity in this range.</p>
              )}
            </section>
          </>
        )
      )}
    </div>
  );
}
