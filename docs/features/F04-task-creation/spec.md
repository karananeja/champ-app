# F04 — Technical Spec

Implements `intent.md` (approved 2026-10-11). Binding decisions: D-009, D-011, D-052, D-059, D-061–D-065, plus everything from F01–F03 and CR-01. Follow the existing structure and conventions (module layout, error helpers, shared zod schemas and permission helpers, refs/INACTIVE_REFERENCE helpers, lookups, combobox, table→cards, E2E setup). Reuse; don't duplicate.

## 1. Data model (Prisma)

```prisma
model Counter { name String @id; value Int @default(0) }   // 'OM', 'OE', 'TK'

enum TaskStatus { OPEN ASSIGNED IN_PROGRESS COMPLETED }     // stored aggregate, see §2
enum FitmentStatus {
  OPEN ASSIGNED IN_PROGRESS SUBMITTED OE_VERIFIED OM_APPROVED
  CLOSED_NOT_DONE MOVED_TO_FT REOPENED
}

model Task {
  id                 String   @id @default(cuid())
  omNo               Int      @unique          // shown as OM-00001
  oeNo               Int      @unique          // shown as OE-00001
  taskTypeId         String                    // LookupItem TASK_TYPE, code OT for F04
  clientId           String
  siteId             String
  locationId         String                    // copied from site.locationId (D-061)
  pocName            String
  pocPhone           String
  pocEmail           String?
  oeId               String                    // User role OE
  technicianType     TechnicianType?
  assetTypeId        String                    // LookupItem ASSET_TYPE
  activityId         String
  deviceTypeId       String                    // LookupItem DEVICE_TYPE
  makeModelId        String?                   // required iff asset type code VEHICLE
  installationTypeId String                    // LookupItem INSTALLATION_TYPE
  requestedAt        DateTime                  // requested fitment date+time (UTC)
  fitmentAt          DateTime                  // fitment date+time (UTC)
  shiftTypeId        String                    // LookupItem SHIFT_TYPE
  issueReportedId    String                    // LookupItem ISSUE_REPORTED
  gpsAddress         String?
  comments           String?
  vehicleEntry       VehicleEntry              // COUNT | CSV
  status             TaskStatus @default(OPEN)
  createdById        String
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  deletedAt          DateTime?
  deletedById        String?
  fitments           Fitment[]
  events             TaskEvent[]
  @@index([status, deletedAt]) @@index([oeId]) @@index([clientId]) @@index([fitmentAt])
}
enum VehicleEntry { COUNT CSV }

model Fitment {
  id            String        @id @default(cuid())
  tkNo          Int           @unique        // TK-00001
  taskId        String
  seq           Int                          // 1..N within task
  status        FitmentStatus @default(OPEN)
  technicianId  String?
  vehicleRegNo  String?
  chassisNo     String?
  assetNumber   String?
  oldDeviceId   String?
  createdAt/updatedAt
  @@unique([taskId, seq]) @@index([technicianId, status])
}

model TaskEvent {
  id         String   @id @default(cuid())
  taskId     String
  fitmentId  String?
  actorId    String
  type       String     // TASK_CREATED | TASK_UPDATED | FITMENT_ASSIGNED | FITMENT_UNASSIGNED | FITMENT_UPDATED | TASK_DELETED (F05 adds more)
  fromStatus String?
  toStatus   String?
  data       Json?      // diff {field: [before, after]} or payload
  createdAt  DateTime @default(now())
  @@index([taskId, createdAt])
}
```

- Every FK to `LookupItem` is validated for the right `kind` with the existing F02 refs helpers. New references must be active; on edit, an unchanged reference may be inactive.
- Human ids: `nextNumber(tx, name, count=1)` does an atomic `UPDATE "Counter" SET value = value + $n … RETURNING value` (upsert on first use) inside the same transaction. Format helpers in shared: `formatOmId(n) → "OM-00001"` (pad 5, grows beyond), same for OE and TK, plus a parser for search.
- Times: the API accepts and returns ISO strings. The web enters and shows them in **Asia/Kolkata**. CSV date format is `YYYY-MM-DD HH:mm`, read as IST.

## 2. Status rules for F04
- A new fitment is `ASSIGNED` if it has a technician, otherwise `OPEN`. Assign: OPEN→ASSIGNED, or ASSIGNED→ASSIGNED for a reassign. Unassign: ASSIGNED→OPEN. Assigning is only allowed while the fitment is OPEN or ASSIGNED; otherwise 409 `FITMENT_LOCKED`.
- `recomputeTaskStatus(tx, taskId)` is the single function that sets `Task.status`. F05 will extend it.
  - Any fitment OPEN → `OPEN`.
  - Else all fitments ASSIGNED → `ASSIGNED`.
  - Else, if every fitment is in {OM_APPROVED, CLOSED_NOT_DONE, MOVED_TO_FT} → `COMPLETED`.
  - Otherwise → `IN_PROGRESS`.
- **"Untouched"** (allows edit and delete): every fitment is OPEN or ASSIGNED, and the task isn't deleted. Edit or delete otherwise → 409 `TASK_STARTED`.
- Every mutation writes `TaskEvent` rows in the same transaction.

## 3. Permissions (in shared)
- `canCreateTask(user)`: SA, OM, OE.
- `canViewTasks(user)`: SA, OM, OE, RO (OT → 403 on every `/tasks` route).
- `canManageTask(user, task)`: SA or OM, or OE when `task.oeId === user.id`. Covers edit and assign.
- `canDeleteTask(user)`: SA or OM.
- An OE creating a task: `oeId` is forced to self. Supplying a different OE gives 403.

## 4. API (prefix `/api`)

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/tasks/options` | canCreateTask | `{ oes: [{id,name}] (active OE; an OE gets only self), technicians: [{id,name,technicianType,baseLocation}] (all active OTs) }` |
| POST | `/tasks` | canCreateTask | Body: every form field, plus `vehicles` as one of `{ entry:'COUNT', count:1..500 }` or `{ entry:'CSV', rows:[{vehicleRegNo?,chassisNo?,assetNumber?,oldDeviceId?}] (1..500) }`, plus optional `technicianId`. Validation: site belongs to client and is active; makeModel required iff asset type is VEHICLE and null otherwise; activity's asset type matches; the technician is an active OT and matches `technicianType` if both are given (if only the technician is given, set the type from them); `fitmentAt` is required. Creates the Task, N fitments, counters and events in one transaction. Returns the task detail |
| GET | `/tasks` | canViewTasks | Query: `view=open\|assigned\|all` (open = not deleted and status ≠ COMPLETED; assigned = `oeId = me`, OE only), `q` (matches `OM-`/`OE-`/`TK-` ids or numbers, client name, POC name), `clientId, oeId, technicianId, status, activityId, from, to` (on fitmentAt), `page, pageSize, sort` (fitmentAt or createdAt, asc/desc). Items: ids, client, site, city, activity, assetType, oe, fitment counts `{total, assigned, open}`, fitmentAt, status |
| GET | `/tasks/:id` | canViewTasks | Full task with resolved names, fitments (with technician), permissions flags for the caller `{canEdit, canAssign, canDelete}` |
| PATCH | `/tasks/:id` | canManageTask, untouched | Header fields only (not vehicles or count). Same validation. Event carries the diff |
| PATCH | `/tasks/:id/fitments/:fid` | canManageTask, fitment OPEN/ASSIGNED | `{ vehicleRegNo?, chassisNo?, assetNumber?, oldDeviceId? }` |
| POST | `/tasks/:id/assign` | canManageTask | `{ fitmentIds: string[] (≥1), technicianId: string \| null }`. Bulk assign/unassign within one task. All-or-nothing; 409 if any fitment is locked |
| DELETE | `/tasks/:id` | canDeleteTask, untouched | Soft delete plus a TASK_DELETED event. Deleted tasks are excluded everywhere |
| GET | `/tasks/export` | canViewTasks | Same query as the list without paging (cap 10,000 rows), `format=csv\|xlsx`. One row per task with readable columns. Use `exceljs` for xlsx. Filename `champ-tasks-YYYYMMDD-HHmm.(csv\|xlsx)` |
| GET | `/tasks/bulk/sample` | canCreateTask | Sample CSV: header plus 2 example rows using real active seed names |
| POST | `/tasks/bulk/preview` | canCreateTask | multipart `file` (CSV, ≤2 MB, ≤1,000 rows; multer memory). Returns `{ rows: [{ rowNumber, data, errors: {column: message}[] , valid }], validCount, invalidCount }`. Doesn't write anything |
| POST | `/tasks/bulk/import` | canCreateTask | `{ rows: <the original row objects> }`. Re-validates on the server, creates only the valid rows (each task in its own transaction), and returns `{ created: [{rowNumber, omId}], failed: [{rowNumber, errors}] }` |

**Bulk CSV columns** (D-064; header names are exact and case-insensitive):

`customer` (code or name), `site` (name within customer), `oe_email` (blank → self for OE; required for SA/OM), `technician_email` (optional), `technician_type` (optional: payroll / third party / contractual), `asset_type`, `activity`, `device_type` (blank → LAF5), `vehicle_make`, `vehicle_model` (Vehicle only), `installation_type`, `requested_fitment_at`, `fitment_at`, `shift_type`, `vehicle_count` (1–500), `issue_reported`, `poc_name` (blank → client contact), `poc_phone` (blank → client contact), `poc_email`, `gps_address`, `comments`.

All lookups match case-insensitively against active values. Parse with `papaparse` on the server (trim, skip empty lines). Put the column-to-input mapping and row validation in one module that both preview and import use.

**Vehicle CSV** (create form, D-062): columns `registration_number, chassis_number, asset_number, old_device_id`, all optional, at least one data row, up to 500. Parsed in the browser with papaparse. The form provides a sample download.

## 5. Web
- **Navigation:** a **Tasks** group for SA, OM, OE and RO containing:
  - Create task (creators only)
  - Bulk upload (creators only)
  - Open tasks
  - Assigned (OE only)
  - Travel tasks, Faulty tasks and Re-opened: placeholder pages saying "Coming in a later release", with an empty-state illustration or icon
- **`/tasks/new` and `/tasks/:id/edit`:** a full page with the intent's sections, using React Hook Form and zod from shared.
  - Customer → site cascade. POC prefill only fills empty or untouched fields on client change.
  - Asset type → activity cascade. Make/model shown only for VEHICLE.
  - Technician type radio filters the technician combobox. Choosing a technician sets the radio.
  - The OE field is disabled and preset for an OE.
  - Vehicle entry radio: either a count input, or a CSV upload with a preview table of the parsed rows, an errors list and a sample download.
  - Date-time inputs are in IST. Device type defaults to LAF5.
  - Inactive options are never offered. In edit mode, an inactive current value shows as "(inactive)".
- **`/tasks/bulk`:** download sample → upload → preview table (valid rows tick, invalid rows red with per-cell messages and tooltips) → "Import N valid rows" → results summary with links to the created tasks and an "Download error rows (CSV)" button, which writes the original columns plus an `errors` column.
- **`/tasks` (Open) and `/tasks/assigned`:** a shared `TaskTable` with the intent's filters, id search, sorting, pagination and a Download menu (CSV, Excel) that hits `/tasks/export` with the current filters. Cards on mobile.
- **`/tasks/:id`:** header with OM, OE and status badges, then sections mirroring the form. The fitments table has checkboxes for bulk assign/unassign (technician combobox) and inline vehicle edit while editable. Edit and Delete buttons are driven by the server's permission flags. Delete opens a confirmation dialog.
- RO sees no mutating controls. OT can't see the Tasks menu.

## 6. Seed / demo
- Base seed: create Counter rows if missing.
- `db:seed:demo`: add 3 demo tasks (one Open, one Assigned, one with mixed technicians), using the demo clients and technicians. Idempotent: skip if demo tasks exist, marked by the comments field `[demo]`.

## 7. Tests
- **Shared:** id format and parse; schemas (vehicles union, makeModel rule); permission helpers.
- **API:**
  - create with count and with CSV vehicles; the auto-split count; ids are sequential and unique (create two tasks concurrently and get no duplicate numbers)
  - technician → all ASSIGNED; no technician → OPEN; technician/type mismatch
  - client/site mismatch; inactive references; makeModel required only for Vehicle; activity/asset mismatch
  - an OE forced to self, and gets 403 for another OE
  - list views: open vs assigned; filters; id search (`OM-00001`, `tk-1`, `1`)
  - detail permission flags
  - edit while untouched, and 409 after a fitment is set to IN_PROGRESS directly in the DB
  - assign/unassign bulk; locked fitment gives 409
  - delete: OM ok, OE 403, started task 409; deleted tasks hidden
  - export CSV and xlsx (parse back with exceljs, check row count)
  - bulk preview: good and bad rows with specific messages; import: only valid rows created; the OE row rule
  - RO read-only; OT 403
  - TaskEvent rows written for each mutation
- **Web:**
  - create form: cascades, conditional make/model, OE lock, technician-type filter, vehicle CSV parse and errors
  - bulk page preview rendering
  - TaskTable filters building the query, and the export URL
- **E2E** (desktop and 360 px):
  - An OM creates a task for 3 vehicles without a technician, assigns fitments to two technicians, and sees the counts.
  - An OE creates a task and sees the OE field locked; it appears under Assigned.
  - Bulk: upload a fixture with 2 valid and 1 invalid rows, check the preview errors, and import 2.
  - The OM deletes an untouched task. RO has no actions.
  - Downloads: assert that the CSV download event fires.

## 8. Definition of done
- Migration applies on top of the current dev DB.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm test:e2e` all pass.
- Dev smoke test: create a task through the API with curl, then list, export and delete it. Leave no processes running.
- README updated.
- `test-report.md` includes a UAT checklist covering all 12 acceptance criteria, plus the sample CSV fixtures the user can use, saved under `docs/features/F04-task-creation/samples/`.
