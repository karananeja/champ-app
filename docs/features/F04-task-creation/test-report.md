# F04 — Test Report

| | |
|---|---|
| Date | 2026-10-11 |
| Branch | `feature/F04-task-creation` |
| Environment | macOS, Node 24, pnpm 10.33, Docker (postgres:16-alpine, pgsty/minio), Chromium (Playwright 1.64) |
| Result | **All gates pass**: typecheck, lint, 453 unit/integration tests, 28 E2E tests (1 skipped by design) |

## 1. Definition of done

| Step | Command | Result |
|---|---|---|
| Migrate (dev DB with F01–F03 data) | `pnpm db:migrate` | `20261011180000_tasks` applied on top of the three earlier migrations. Additive only (Counter, Task, Fitment, TaskEvent, three enums). Row counts before/after: User 5/5, LookupItem 80/80, Location 8/8, Activity 8/8, Client 1/1, ClientSite 2/2, Invite 5/5 |
| Seed | `pnpm db:seed` | Super Admin skipped (exists), masters unchanged, counters OM/OE/TK created at 0 |
| Run | `pnpm dev` | API :4000 and web :5173, `/api/health` `{"ok":true,"db":"up"}` on both |
| Smoke test (SA, through the web proxy) | `POST /api/tasks` (2 vehicles), `GET /api/tasks?q=OM-1`, `GET /api/tasks/export?format=csv` and `format=xlsx`, `DELETE /api/tasks/:id`, `GET /api/tasks/:id` | 201 → `OM-00001 OE-00001 OPEN TK-00001,TK-00002`, city Bengaluru; list total 1; CSV `attachment; filename=champ-tasks-20261012-0012.csv` (header + 1 row); xlsx 200 (7.4 kB); delete 204; get 404 |
| Clean-up | SQL | The smoke-test task, its fitments and events were removed and the counters reset to 0, so the dev DB has no tasks. Servers stopped; no processes left running. `pnpm db:seed:demo` was not run on the dev DB (UAT step 0 covers it) |

The base and demo seeds were also run twice against a throw-away database: the demo seed created `OM-00001`
(Open, 3 fitments), `OM-00002` (Assigned to Ravi, 2) and `OM-00003` (split Ravi/Suresh, 3 from CSV rows); the second
run skipped them.

## 2. Quality gates

| Command | Result |
|---|---|
| `pnpm typecheck` | exit 0 (shared, api, web) |
| `pnpm lint` | exit 0: 0 errors, 0 warnings |
| `pnpm test` | exit 0: **453 passed / 0 failed** (shared 141, api 238, web 74) |
| `pnpm test:e2e` | exit 0: **28 passed / 0 failed / 1 skipped** |

| Suite | Before (CR-01) | After |
|---|---|---|
| `packages/shared` | 95 | **141** (+46, `test/tasks.test.ts`) |
| `apps/api` | 194 | **238** (+44: `tasks.test.ts` 31, `tasks-bulk.test.ts` 11, counters 2) |
| `apps/web` | 49 | **74** (+25) |
| E2E | 20 + 1 skipped | **28 + 1 skipped** (+8: 4 tests × 2 viewports) |

### 2.1 Shared
`test/tasks.test.ts`: OM/OE/TK formatting (padding, > 5 digits) and parsing (`OM-00001`, `om-1`, `TK00012`, `oe 7`,
bare numbers; rejects junk); permission helpers for every role, `canManageTask` own/other OE; `deriveTaskStatus` and
the untouched rule; IST parsing/formatting (`YYYY-MM-DD HH:mm` and `datetime-local`, impossible dates, file stamp);
vehicles union (count 1–500, CSV 1–500 rows, field length, unknown entry); create schema messages, blanks → null;
**make/model rule** (`createTaskSchemaFor`); update/fitment/assign schemas; list query defaults; CSV quoting; vehicle
CSV conversion and errors.

### 2.2 API (against `champ_test`)
- `test/tasks.test.ts`: create by **count** and by **CSV vehicles**; vehicles validation; **technician → all
  Assigned** and type taken from them; technician/type **mismatch**, non-OT, inactive OT; **sequential ids and 4
  concurrent creates with no duplicates** (OM, OE and 14 TK numbers), a failed create gives no number away;
  **client/site mismatch**; **inactive** client, site, OE, shift, activity, make/model; wrong lookup kind;
  **make/model for Vehicle only**; **activity/asset mismatch**; **OE forced to self** (403 for another OE). Lists:
  open vs assigned, completed tasks drop out of Open, sort, every **filter** (incl. IST day boundaries), **id search**
  (`OM-00002`, `oe-3`, `tk-1`, `TK-00004`, `1`, `5`) plus customer/POC, paging. **Permission flags** per role and once
  work starts; **RO read-only and OT 403** on every route; options. **Edit** while untouched with the **diff event**,
  no-op saves record nothing, **409 after a fitment is set to IN_PROGRESS in the DB**, unchanged inactive references
  kept, switching to an inactive one refused, battery switch clears make/model, OE rules. Fitment vehicle edit and
  409 `FITMENT_LOCKED`. **Assign/unassign in bulk** with status recompute and per-fitment events; **locked fitment →
  409 with no change**; foreign fitments, non-OT, other OE. **Delete**: OE 403, OM 204, hidden everywhere, event kept;
  started → 409. `recomputeTaskStatus` for every rule.
- `test/tasks-bulk.test.ts`: **preview** good and bad rows with the exact messages (customer, date format, count,
  make/model on a battery, missing OE email, technician type, site of another customer, shift, required make),
  schema format errors mapped to columns, tolerant headers/blank lines, file errors (missing columns, empty,
  non-CSV, 1,001 rows, no file, > 2 MB); **import** creates only valid rows (POC and LAF5 defaults, IST conversion);
  **the OE row rule**; body validation; **sample** has all columns and previews as valid; **export CSV** (columns, IST
  times, formula guard) and **xlsx parsed back with exceljs** (row count); export filters.
- `seed.test.ts`: counters created once and kept on re-run; first use and rollback give numbers back.
- `clients.test.ts`: the `/lookups` clients assertion now includes the primary contact (D-067).

### 2.3 Web (jsdom)
- `TaskForm.test.tsx` (9): **customer → site cascade**, POC prefill that keeps typed values, single-site preselect;
  **asset → activity cascade**, **make/model only for Vehicle**, LAF5 default; required-field messages and the
  make/model rule with no API call; **OE lock**; **technician-type filter** and type set from the technician; create
  body with **IST → UTC**; **vehicle CSV** parse errors, preview and the CSV rows in the body; server field errors;
  edit page (IST prefill, inactive value shown, no vehicles/technician, PATCH body).
- `TaskTable.test.tsx` (5): query/export-URL builders; rows; **filters → list query** and clear; **Download → Excel**
  hits `/tasks/export` with the filters and saves the server's file name; OE filter hidden for OEs.
- `BulkUploadPage.test.tsx` (3): **preview rendering** (valid/invalid rows, red cells with tooltips, cards), multipart
  upload, error-rows CSV content, import of only valid rows and result links; file-level error; sample download.
- `nav.test.ts` (+1, 1 changed): Tasks group per role. `App.test.tsx` (+7): task route guards and placeholder pages.

### 2.4 E2E (desktop 1280×720 and mobile 360×740)
`e2e/tasks.spec.ts` (all ✓ on both viewports; every page checked for horizontal overflow):
1. **OM creates a task for 3 vehicles without a technician**, assigns one fitment to technician A and two to B; counts
   go 0 → 1 → 3 assigned, status Open → Assigned; the Open list finds it by lower-case id with `3/3`; **CSV and Excel
   download events fire** with `champ-tasks-YYYYMMDD-HHmm.(csv|xlsx)`.
2. **OE creates a task**: OE field locked to themselves, Battery hides make/model, vehicle sample downloads, a 2-row
   vehicle CSV previews and creates 2 fitments with the details; no Delete, Edit shown; the task is under **Assigned**.
3. **Bulk**: sample downloads; a generated file with **2 valid and 1 invalid** row previews with the error; error rows
   download; **2 tasks imported**, the second has 4 open fitments.
4. **RO** sees the list and detail with no create/edit/assign/delete controls and is refused `/tasks/new`; the **OM
   deletes the untouched task**, which disappears for both.

The `setup` project now also creates a task OM, OE and RO and one untouched task per viewport (D-070).

## 3. Known limitations
- **Workflow beyond Open/Assigned is F05.** Statuses In progress, Submitted, etc. exist in the schema but nothing in
  F04 sets them (tests set them directly in the DB). No history tab yet; events are stored only.
- **Travel / Faulty / Re-opened** pages are placeholders.
- **Bulk rows use a vehicle count only** (D-064); vehicle details are entered later on the task page.
- **Row numbers** in the bulk preview count data rows after skipping blank lines, so they can differ from the
  spreadsheet line number if the file has blank lines in the middle.
- **Export cap** is 10,000 rows, and is built in memory.
- The fitment vehicle editor and assignment have no undo; every change is in `TaskEvent`.
- Dates are always IST; there is no time-zone setting.

## 4. UAT checklist

Sample files: [`samples/bulk-valid.csv`](samples/bulk-valid.csv) (3 valid rows),
[`samples/bulk-mixed.csv`](samples/bulk-mixed.csv) (3 valid, 2 invalid), [`samples/vehicles.csv`](samples/vehicles.csv)
(5 vehicles). The bulk samples use the demo data, so run step 0 first.

0. [ ] `pnpm db:migrate`, `pnpm db:seed`, `pnpm db:seed:demo`, `pnpm dev`. Demo accounts (`Demo@1234`):
   `demo.om@`, `demo.oe@`, technicians `ravi.ot@` (Payroll), `suresh.ot@` (Third party), `amit.ot@` (Contractual),
   all `@intellicar.in`. Create an RO from Users → Invite user if you don't have one. Open tasks already shows three
   `[demo]` tasks.

| AC | Steps | Expected |
|---|---|---|
| 1 | As `demo.om@`: Tasks → Create task. Customer *Demo Fleet Rentals*, site *Bengaluru depot*, OE *Esha (Demo OE)*, technician *Ravi Kumar*, Vehicle / New installation / Tata Ace / GPS, both dates, Day, **5** vehicles, an issue → Create task | Task page shows `OM-…` and `OE-…` badges, status Assigned, "5 total · 5 assigned · 0 open", five `TK-…` rows all *Ravi Kumar*, Assigned |
| 2 | Create another task without a technician (3 vehicles). On its page tick the first fitment → technician *Ravi Kumar* → Assign; tick another → *Suresh Patil* → Assign | Fitments start Open; after the two assigns the rows show Ravi and Suresh, counts "3 total · 2 assigned · 1 open", task status stays Open until all are assigned |
| 3 | Sign in as `demo.oe@` → Create task | Operation executive shows *Esha (Demo OE)* and is greyed out ("Tasks you create are yours") |
| 4 | On Create task pick asset type *Battery*; open Activity; open Customer/Site/other dropdowns. Optionally deactivate a value in Masters first | Make/model disappears; Activity lists only Battery activities; no inactive client, site or master value is offered |
| 5 | Pick customer *Demo Fleet Rentals*, then *Demo Logistics* | POC name/phone/email fill from the client contact (typed values are kept on change); Site lists only that client's active sites (Delhi hub is preselected for Demo Logistics) |
| 6 | Create task → Vehicle list *Upload CSV* → choose `samples/vehicles.csv` → Create | Preview shows 5 vehicles; the task has 5 fitments with the registration/chassis/asset/old device values |
| 7 | Tasks → Bulk upload → *Download sample CSV*; upload `samples/bulk-mixed.csv` (as `demo.om@`) | Sample downloads. Preview "3 valid · 2 with errors"; row 4 red (customer, requested date, vehicle count) and row 6 red (technician type, make/model on a battery), hover a red cell for the reason. *Import 3 valid rows* → 3 task links. *Download error rows (CSV)* gives the 2 rows with an `errors` column. (`samples/bulk-valid.csv` imports all 3.) |
| 8 | Open tasks: search `OM-1`, `tk-2`, a customer name; use customer/OE/technician/status/activity/date filters; Download → CSV and Excel | The list narrows accordingly; both files download and contain only the filtered rows (times in IST) |
| 9 | As `demo.oe@`: Tasks → Assigned | Tasks where Esha is the OE (all demo tasks and those created above for her) |
| 10 | As `demo.om@` open an untouched task → Delete → confirm. As `demo.oe@` open a task. Edit a task before work starts (Edit task → change POC → Save) | OM: task deleted and gone from lists. OE: no Delete button. Edit saves and the detail shows the change |
| 11 | Sign in as an RO: Tasks menu, Open tasks, a task page; try `/tasks/new` | Lists and details visible; no Create task, Bulk upload, Edit, Delete, checkboxes or vehicle edit; `/tasks/new` redirects with "You don't have access to that page" |
| 12 | Repeat a few of the above at 360 px width (DevTools device mode); run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e` | Tables turn into cards, no sideways scrolling; all commands pass |
