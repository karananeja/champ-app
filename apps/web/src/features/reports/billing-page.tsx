import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, ReceiptIndianRupee } from 'lucide-react';
import type { BillingClientGroup, BillingRow } from '@champ/shared';
import { ListStates } from '@/components/list-states';
import { PageHeader } from '@/components/page-header';
import { SearchableSelect } from '@/components/searchable-select';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatIst } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useLookups } from '../masters/queries';
import { DownloadButton } from './download-button';
import { useBillingReport } from './queries';
import { defaultBillingMonth, formatMonth, recentMonths } from './report-utils';

const COLUMNS: { header: string; cell: (r: BillingRow) => string }[] = [
  { header: 'OM id', cell: (r) => r.omId },
  { header: 'Site', cell: (r) => r.site },
  { header: 'Vehicle', cell: (r) => r.vehicleRegNo ?? r.chassisNo ?? '–' },
  { header: 'Device id', cell: (r) => r.deviceId ?? '–' },
  { header: 'Activity', cell: (r) => r.activity },
  { header: 'Technician', cell: (r) => r.technician ?? '–' },
  { header: 'Final issue', cell: (r) => r.finalIssue ?? '–' },
  { header: 'Verified', cell: (r) => (r.verifiedAt ? formatIst(r.verifiedAt) : '–') },
  { header: 'Approved', cell: (r) => formatIst(r.approvedAt) },
];

/** One client: a header button with the counts that shows/hides its rows (table on md+, cards on phones). */
function ClientGroup({ group, defaultOpen }: { group: BillingClientGroup; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = `billing-${group.clientId}`;
  return (
    <Card className="gap-0 py-0" data-testid="billing-group">
      <button
        type="button"
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-4 py-3 text-left focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronRight className={cn('size-4 shrink-0 transition-transform', open && 'rotate-90')} aria-hidden="true" />
        <span className="min-w-0 flex-1 font-semibold break-words">{group.client}</span>
        <span className="text-sm tabular-nums" data-testid="billable-count">
          {group.billableCount} billable
        </span>
        {group.nonBillableCount > 0 && <span className="text-sm text-muted-foreground tabular-nums">{group.nonBillableCount} non-billable</span>}
      </button>
      {open && (
        <div id={panelId} className="border-t">
          {group.rows.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">No billable fitments for this client.</p>
          ) : (
            <>
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>TK id</TableHead>
                      {COLUMNS.map((c) => (
                        <TableHead key={c.header}>{c.header}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.rows.map((r) => (
                      <TableRow key={r.fitmentId} data-testid="billing-row">
                        <TableCell className="font-mono font-medium">
                          <Link className="text-primary hover:underline" to={`/tasks/${r.taskId}`}>
                            {r.tkId}
                          </Link>
                        </TableCell>
                        {COLUMNS.map((c) => (
                          <TableCell key={c.header} className="whitespace-normal">
                            {c.cell(r)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <ul className="grid grid-cols-1 gap-2 p-3 md:hidden">
                {group.rows.map((r) => (
                  <li key={r.fitmentId} className="rounded-md border p-3" data-testid="billing-card">
                    <Link className="font-mono font-medium text-primary hover:underline" to={`/tasks/${r.taskId}`}>
                      {r.tkId}
                    </Link>
                    <dl className="mt-2 grid grid-cols-1 gap-1 text-sm">
                      {COLUMNS.map((c) => (
                        <div key={c.header} className="grid grid-cols-[6.5rem_1fr] gap-2">
                          <dt className="text-muted-foreground">{c.header}</dt>
                          <dd className="min-w-0 break-words">{c.cell(r)}</dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

/** Monthly billing report (F15, D-264): billable fitments finally approved in the IST month, grouped by client. */
export function BillingPage() {
  const [month, setMonth] = useState(defaultBillingMonth);
  const [clientId, setClientId] = useState<string | null>(null);
  const lookups = useLookups();
  const query = { month, clientId: clientId ?? undefined };
  const { data, isPending, isError, error, refetch } = useBillingReport(query);
  const groups = data?.clients ?? [];
  const months = recentMonths();
  if (!months.includes(month)) months.push(month);
  const empty = !data || (data.totals.billable === 0 && data.totals.nonBillable === 0);

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        icon={ReceiptIndianRupee}
        title="Billing"
        description="Billable fitments with final approval in the month (IST), by client."
        actions={
          <>
            <DownloadButton path="/reports/billing" query={{ ...query, format: 'csv' }} fallbackName={`billing-${month}.csv`} disabled={empty}>
              Download CSV
            </DownloadButton>
            <DownloadButton path="/reports/billing" query={{ ...query, format: 'xlsx' }} fallbackName={`billing-${month}.xlsx`} disabled={empty}>
              Download Excel
            </DownloadButton>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger aria-label="Billing month" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {months.map((m) => (
              <SelectItem key={m} value={m}>
                {formatMonth(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <SearchableSelect
          aria-label="Filter by customer"
          value={clientId}
          onChange={setClientId}
          options={(lookups.data?.clients ?? []).map((c) => ({ value: c.id, label: c.name, hint: c.code ?? undefined }))}
          clearLabel="All customers"
          searchPlaceholder="Search customer"
        />
      </div>

      {data && !empty && (
        <dl className="grid grid-cols-2 gap-3 sm:max-w-md" aria-label="Totals">
          <div className="rounded-xl border bg-card p-4">
            <dt className="text-sm text-muted-foreground">Billable</dt>
            <dd className="text-3xl font-semibold" data-testid="total-billable">
              {data.totals.billable}
            </dd>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <dt className="text-sm text-muted-foreground">Non-billable</dt>
            <dd className="text-3xl font-semibold" data-testid="total-non-billable">
              {data.totals.nonBillable}
            </dd>
          </div>
        </dl>
      )}

      <ListStates
        isPending={isPending}
        isError={isError}
        error={error}
        onRetry={() => void refetch()}
        isEmpty={empty}
        filtered={!!clientId}
        onClearFilters={() => setClientId(null)}
        empty={{ title: `Nothing to bill for ${formatMonth(month)}`, description: 'No fitments had their final approval in this month.' }}
      >
        <div className="grid grid-cols-1 gap-3">
          {groups.map((g) => (
            <ClientGroup key={`${month}-${g.clientId}`} group={g} defaultOpen={groups.length <= 3} />
          ))}
        </div>
      </ListStates>
    </div>
  );
}
