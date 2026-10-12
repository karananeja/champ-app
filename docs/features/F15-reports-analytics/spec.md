# F15 — Technical Spec

Implements `intent.md` (approved 2026-10-12). Binding decisions: D-018, D-025, D-030, D-074, D-091, D-101, D-127, D-216/D-222 (day distance and its cache), D-258 (nav: shell computes active state), D-264–D-268, plus everything from F01–F14 and CR-01–CR-11. Reuse, don't duplicate:
- the task export code (`apps/api/src/modules/tasks/export.ts`: CSV via `toCsv`, Excel via exceljs, IST formatting, `Content-Disposition`) for the billing and KPI downloads
- the TaskEvent log (append-only) and `ReopenAttribution` (D-074) for counts over time — the fitment columns (`submittedAt`, `verifiedAt`, `approvedAt`, `billable`) are **cleared or overwritten** by a reopen/resubmit, so use events where a count over a period is needed
- `DayDistance` (F12) and `straightLineRoute` for km; `istDayStart`/IST helpers; the visibility helpers used by task lists and the technician scoping used by F12 reportees (OE → own technicians)
- web: `PageHeader`, the date pickers (`DatePicker`, `DateRangePicker`), searchable selects, the table/card list patterns, `lib/download.ts`, `nav.ts` (CR-10 shape)

Two parallel agents (D-127):

| Agent | Owns |
|---|---|
| **Backend** | `packages/shared`, `apps/api`: §1–§4, §7 |
| **Web** | `apps/web` (incl. `e2e/` and its `package.json` for a chart library): §5–§6 |

**Only the Web agent runs the full gates and E2E**, after the Backend agent's last commit.

## 1. Shared (`packages/shared/src/reports.ts`, exported). Backend commits it FIRST with the subject `feat(F15): shared reports contracts`.

```ts
export const REPORT_ROLES_BILLING: readonly Role[] = ['SUPER_ADMIN', 'OM', 'RO'];
export const REPORT_ROLES_ANALYTICS: readonly Role[] = ['SUPER_ADMIN', 'OM', 'OE', 'RO'];
export const canViewBilling / canViewAnalytics: (actor) => boolean;

export const billingQuerySchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), clientId: z.string().optional(), format: z.enum(['json','csv','xlsx']).default('json') });
export interface BillingRow {
  fitmentId: string; tkId: string; taskId: string; omId: string; site: string; vehicleRegNo: string | null; chassisNo: string | null;
  deviceId: string | null; activity: string; technician: string | null; finalIssue: string | null; verifiedAt: string | null; approvedAt: string;
}
export interface BillingClientGroup { clientId: string; client: string; billableCount: number; nonBillableCount: number; rows: BillingRow[] }
export interface BillingReportResponse { month: string; clients: BillingClientGroup[]; totals: { billable: number; nonBillable: number } }

export const analyticsQuerySchema = z.object({
  from: isoDay, to: isoDay,            // IST days, inclusive; ≤ 366 days; from ≤ to
  clientId: z.string().optional(), oeId: z.string().optional(), regionId: z.string().optional(),
  format: z.enum(['json','csv']).default('json'), table: z.enum(['technicians','oes']).optional(), // csv: which table
});
export interface Percentiles { count: number; medianHours: number | null; p90Hours: number | null }
export interface TechnicianKpiRow {
  user: { id: string; name: string }; started: number; submitted: number; workingDays: number; fitmentsPerDay: number | null;
  reopens: number; reopenRate: number | null; movedToFt: number; faultyRate: number | null; km: number; kmApprox: boolean;
  fieldTat: Percentiles;
}
export interface OeKpiRow { user: { id: string; name: string }; verified: number; reopens: number; reopenRate: number | null; endToEndTat: Percentiles }
export interface WeeklyPoint { weekStart: string /* IST Monday */; submitted: number; approved: number; reopens: number; movedToFt: number; started: number; km: number }
export interface AnalyticsResponse {
  from: string; to: string;
  statusCounts: { status: FitmentStatus; count: number }[];   // fitments whose task date is in the range, by current status
  turnaround: { field: Percentiles; endToEnd: Percentiles };
  reopenRate: { reopens: number; submitted: number; rate: number | null };
  fitmentsPerTechnicianPerDay: { submitted: number; technicianDays: number; average: number | null };
  faultyRate: { movedToFt: number; started: number; rate: number | null };
  km: { total: number; approx: boolean };
  weekly: WeeklyPoint[];
  technicians: TechnicianKpiRow[];   // sorted by name
  oes: OeKpiRow[];                   // empty for an OE viewer except themself
}
```

## 2. Definitions (D-264, D-265). "In the range" = event time on an IST day from `from` to `to`.
- **Billing:** fitments whose **current** status is `OM_APPROVED`, `approvedAt` in the IST month, `billable = true` (non-billable approved ones counted separately), task not deleted; grouped by client (name order), rows by `approvedAt`. A fitment reopened after approval leaves the report until approved again (its `approvedAt` is cleared, D-091).
- **Status counts:** fitments of non-deleted tasks whose `task.fitmentAt` is in the range, by current status (all statuses, zero counts included, in `FITMENT_STATUSES` order).
- **Submitted / started / approved / moved to FT / verified:** counts of the `FITMENT_SUBMITTED` / `FITMENT_STARTED` / `FITMENT_APPROVED` / `FITMENT_MARKED_FAULTY` / `FITMENT_VERIFIED` events in the range (each resubmit counts), attributed to the fitment's technician at the time (the event's actor for technician steps; for VERIFIED, the actor OE).
- **Reopens:** `ReopenAttribution` rows whose event is in the range: per user (OT rows → technician table, OE rows → OE table); overall = number of `FITMENT_REOPENED` events. Rates: technician reopens ÷ technician submitted; OE reopens ÷ OE verified; overall reopens ÷ submitted. `null` when the denominator is 0.
- **Field turnaround:** for each `FITMENT_SUBMITTED` event in the range: its time minus the latest assignment of that fitment to that technician before it (the last `FITMENT_ASSIGNED` event with that technician, or `TASK_CREATED` with `data.technicianId`). **End-to-end:** for each `FITMENT_APPROVED` in the range: its time minus the task's `createdAt`. Median and P90 in hours (one decimal).
- **Fitments per technician per day:** per technician, submitted ÷ working days (IST days in the range with at least one of their `FITMENT_STARTED` events); overall = total submitted ÷ total technician-days.
- **Faulty rate:** moved to FT ÷ started.
- **Km:** per technician, the sum over working days of the F12 day distance: a cached routed `DayDistance` whose signature matches; otherwise straight lines computed on the spot (no OSRM calls here) with `kmApprox: true` (same logic as the reportees list, D-223 — reuse the history module's functions, export them if needed).
- **Weekly:** the same counts bucketed by IST week (Monday start) across the range.
- **Filters:** `clientId`, `oeId` (the task's OE), `regionId` (the task's location's region) restrict the fitments/tasks considered. **OE viewer (D-266):** forced to tasks where `oeId = me` **plus** fitments done by technicians whose manager is me; `oes` holds only themself; an `oeId` filter other than themself → 403.
- Ranges: `from ≤ to`, at most 366 days → 400 otherwise.

## 3. Downloads
- Billing `format=csv`: one flat CSV (client column first). `format=xlsx` (D-268): sheet "Summary" (client, billable, non-billable, totals) + one sheet per client (sheet names sanitised and ≤ 31 chars, unique). Filenames `billing-2026-10.csv/.xlsx` (`-<client>` when filtered). IST dates.
- Analytics `format=csv&table=technicians|oes`: the table as CSV (`analytics-technicians-2026-10-01-to-2026-10-31.csv`).

## 4. API (prefix `/api`)

| Method | Path | Notes |
|---|---|---|
| GET | `/reports/billing?month=&clientId=&format=` | `BillingReportResponse` or file; SA/OM/RO |
| GET | `/reports/analytics?from=&to=&clientId=&oeId=&regionId=&format=&table=` | `AnalyticsResponse` or CSV; SA/OM/OE/RO (OE scoped) |

New module `apps/api/src/modules/reports/` (`billing.ts`, `analytics.ts`, `router.ts`). Use a few aggregate queries (SQL where it's clearer); no per-fitment N+1. Performance target: a month with ~5,000 fitments answers in < 1 s locally.

## 5. Web agent (`apps/web`)
- **Chart library:** load the `dataviz` skill **before writing any chart code** and follow it (palette, marks, accessibility, light/dark — the app has a theme selector since CR-09). If a library is needed, add **one** (e.g. `recharts`, exact version) with `pnpm --filter @champ/web add` — the only install in F15; otherwise hand-rolled SVG is fine.
- **Nav (D-267):** a **Reports** group with *Billing* (`/reports/billing`, billing roles) and *Analytics* (`/reports/analytics`, analytics roles), placed after Tasks; follows the CR-10 nav shape (the shell computes active state).
- **Billing page:** month picker (default: previous month if today is in the first 5 days of a month, else the current month), client filter; per-client collapsible groups with counts and the rows (table on desktop, cards on phones); totals; *Download CSV* / *Download Excel*; empty state.
- **Analytics page:** filters (date range default this month, client, OE — hidden for an OE —, region); KPI tiles (status counts as a small bar chart; field and end-to-end TAT median/P90; reopen rate; fitments per OT per day; faulty rate; km with "≈" when approx) each with a weekly trend sparkline or small chart; *Technicians* and *OEs* tables (sortable by any column; phone cards) with *Download CSV*. Loading, empty and error states; no horizontal page scroll at 360 px.
- **Tests:** unit tests for both pages (filters → query params, rendering groups/tiles/tables, role visibility in nav, downloads call the right URLs, empty/error). **E2E** (`e2e/reports.spec.ts`, desktop + mobile-360): OM opens Billing for the current month and sees the workflow fixtures' approved billable fitment(s) with a working CSV download; OM opens Analytics and sees non-zero submitted/started counts; an OE sees Analytics but no Billing in the menu.

## 6. Definition of done
- **Backend:** shared + API suites, `pnpm typecheck`, `pnpm lint`, `pnpm build`; **no E2E**; last commit subject starts `test(F15):`.
- **Web:** web unit tests and the new E2E (both projects), then — after the Backend's last commit — the **full** `pnpm test && pnpm test:e2e` once.
- Each agent reports wall time, debugging minutes, proposed decisions and README notes. Claude writes the docs and spot-checks the numbers against the lists.

## 7. Backend tests
- billing: month boundaries in IST (approved 23:50 IST on the last day counts in that month), billable vs non-billable, deleted tasks out, reopened-after-approval out, client filter, grouping/sorting, roles (OE/OT 403), CSV columns, Excel sheets (summary + per client, unique sanitised names)
- analytics: each KPI on a hand-built dataset with known answers (incl. a resubmit, an OE reopen vs an OM reopen of a verified fitment, a faulty, two working days), weekly buckets, filters (client, OE, region), the OE scope (own tasks + own technicians; other `oeId` 403), range validation, CSV tables, km from a cached routed distance vs straight-line approx
