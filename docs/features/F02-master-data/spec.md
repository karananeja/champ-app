# F02 — Technical Spec

Implements `intent.md` (approved 2026-10-11). Binding decisions: D-013, D-017, D-022, D-028, D-045, D-046, D-047 and everything from F01. Follow F01's existing structure and conventions (module layout, error format, zod in `@champ/shared`, shadcn/ui, TanStack Query, test setup).

## 1. Data model (Prisma)

```prisma
enum LookupKind {
  ASSET_TYPE DEVICE_TYPE INSTALLATION_TYPE STATE REGION
  ISSUE_REPORTED ISSUE_OBSERVED ACTION_TAKEN FINAL_ISSUE
  ACCESSORY CLOSE_REASON SHIFT_TYPE TASK_TYPE
}

model LookupItem {
  id        String     @id @default(cuid())
  kind      LookupKind
  name      String
  nameKey   String                     // lower(trim(name)), used for uniqueness
  code      String?                    // stable code for built-ins: VEHICLE, BATTERY, OT, TT, FT, DAY, NIGHT, EARLY_MORNING, LAF5
  isSystem  Boolean    @default(false) // built-in: cannot rename or deactivate
  active    Boolean    @default(true)
  billable  Boolean?                   // FINAL_ISSUE only (required there, null elsewhere)
  sortOrder Int        @default(0)
  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt
  @@unique([kind, nameKey])
  @@unique([kind, code])
}

model Activity {
  id          String  @id @default(cuid())
  name        String
  nameKey     String
  assetTypeId String                    // LookupItem of kind ASSET_TYPE
  assetType   LookupItem @relation(...)
  active      Boolean @default(true)
  createdAt/updatedAt
  @@unique([assetTypeId, nameKey])
}

model VehicleMakeModel {
  id String @id @default(cuid())
  make String
  model String
  key  String   // lower(make)|lower(model)
  active Boolean @default(true)
  createdAt/updatedAt
  @@unique([key])
}

model Location {
  id String @id @default(cuid())
  city String
  cityKey String
  stateId String    // LookupItem STATE
  regionId String   // LookupItem REGION
  active Boolean @default(true)
  createdAt/updatedAt
  @@unique([stateId, cityKey])
}

enum TechnicianType { PAYROLL THIRD_PARTY CONTRACTUAL }
```

Additions to **User**: `technicianType TechnicianType?` and `baseLocationId String?` (FK Location). Both are required when `role = OT` and null otherwise.

Additions to **Invite**: `name String?`, `phone String?`, `technicianType TechnicianType?`, `baseLocationId String?`. When an invite is accepted, these are copied to the new user. The accept-invite page prefills name and phone if present.

Validation of FKs to `LookupItem` must check the right `kind` (for example, `Activity.assetTypeId` must point to an ASSET_TYPE item). Do this in the service layer.

## 2. Seed (idempotent, upsert on kind+code or kind+nameKey)
Seed every master with the values in the intent's table. Built-ins get `isSystem: true` and a `code`:
- ASSET_TYPE: Vehicle (`VEHICLE`), Battery (`BATTERY`).
- SHIFT_TYPE: Day (`DAY`), Night (`NIGHT`), Early morning (`EARLY_MORNING`).
- TASK_TYPE: OT, TT, FT, each named after its code, with descriptions handled in the UI: Operation task, Travel task, Faulty task.
- DEVICE_TYPE: LAF5 (`LAF5`). It is not a system item; the user can add more later.
- STATE: all 28 states and 8 UTs.

Every other seeded value is plain dummy data. Add 2–3 sample OTs only in a separate `pnpm db:seed:demo` script, not in the base seed.

## 3. API (prefix `/api`)

Permission helpers (put the pure checks in shared so web and API agree):
- `canEditMasters(user)`: SA or OM.
- `canEditTaskTypes(user)`: SA, or OM with `canManageTaskTypes`.
- `canManageTechnician(actor, tech)`: SA or OM for any technician; OE only when `tech.managerId === actor.id`.

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/lookups` | any authenticated | **Active** values only, grouped: `{ assetTypes, activities (with assetTypeId), deviceTypes, makeModels, installationTypes, states, regions, locations (with state/region names), issuesReported, issuesObserved, actionsTaken, finalIssues (with billable), accessories, closeReasons, shiftTypes, taskTypes, technicianTypes }`. Sorted by sortOrder then name. Web caches with long staleTime and invalidates on master edits |
| GET | `/masters/lookup/:kind` | any authenticated | kind in kebab-case URL form (e.g. `final-issue`); all items including inactive; `?q=&active=` |
| POST | `/masters/lookup/:kind` | canEditMasters (TASK_TYPE: canEditTaskTypes) | `{ name, billable? }`; billable is required for FINAL_ISSUE |
| PATCH | `/masters/lookup/:kind/:id` | same | `{ name?, active?, billable?, sortOrder? }`; 409 `SYSTEM_ITEM` when renaming or deactivating an isSystem item |
| GET/POST/PATCH | `/masters/activities[/:id]` | read: any; write: canEditMasters | GET supports `?assetTypeId=&q=&active=` |
| GET/POST/PATCH | `/masters/make-models[/:id]` | same | |
| GET/POST/PATCH | `/masters/locations[/:id]` | same | GET supports `?stateId=&regionId=&q=&active=` |
| GET | `/technicians` | SA, OM, OE, RO | OE: only own. Query `q, type, baseLocationId, managerId, status, page, pageSize`. Returns user fields plus type, baseLocation `{id, city, state}` and manager `{id, name}` |
| POST | `/technicians` | SA, OM, OE | `{ name, phone, email, technicianType, baseLocationId, managerId }`. OE: manager is forced to self. Creates an OT invite with the same rules as F01 `createInvite` (reuse it; don't duplicate). Returns `{ invite, link }` |
| PATCH | `/technicians/:id` | canManageTechnician | `{ name?, phone?, technicianType?, baseLocationId? }`. Reassigning the manager stays on F01's `PATCH /users/:id` |

Other rules:
- Duplicate names → 409 `DUPLICATE`, with a message naming the conflicting value.
- An inactive referenced item (inactive asset type, state or region) can't be chosen for a new or edited record (400). Existing references stay.
- The F01 generic invite (`POST /invites`) with `role = OT` must also require `technicianType` and `baseLocationId` (extend the shared schema with a discriminated refinement). Update the F01 Invite dialog to show those fields when role is OT, so both entry points produce complete OTs.

## 4. Web
- **Navigation:** a new **Masters** sidebar group, visible to every role, and a **Technicians** item, visible to SA, OM, OE and RO. Masters landing page (`/masters`) shows a card grid of the 16 masters with item counts. Each master is at `/masters/:slug`.
- **Generic master page:** build one reusable `MasterTable` and `MasterFormDialog` driven by a config per master (columns, form fields, zod schema, endpoints). Do not write 16 hand-made pages.
  - The page has search, an Active/Inactive/All filter, Add, Edit and an Activate/Deactivate toggle (with confirmation).
  - Inactive rows are greyed out.
  - System items show a lock badge and disabled controls.
  - Final issues have a Billable column and a switch in the form.
  - Activities have an asset-type filter and select. Locations have state and region filters and selects.
- **Read-only users** (RO and OE, and OM for task types without delegation) see the same pages with no Add, Edit or toggle controls.
- **Technicians page (`/technicians`):** table, or cards under `md` width, with filters (type, base location, reporting OE, status) and search.
  - **Add technician** opens a dialog with name, contact, email, type (radio), base location (searchable select) and reporting OE (select; hidden and forced for an OE). On success it shows the F01 one-time link view — reuse that component.
  - **Edit technician** opens a dialog for name, contact, type and base location.
- Use a searchable combobox (shadcn Command + Popover) for any select with more than about 10 options (states, locations).
- Everything must stay responsive at 360 px.

## 5. Tests
- **API:**
  - CRUD for a LookupItem kind, an activity, a make/model and a location
  - duplicate detection, case-insensitive
  - system-item protection
  - FINAL_ISSUE billable required
  - kind validation on FKs
  - inactive references rejected
  - `/lookups` returns only active items
  - permission matrix: SA, OM, OM with and without task-type delegation, OE, OT and RO, on read and write
  - technicians: create (invite produced with the extra fields; acceptance copies them to the user), OE scope (list, patch others → 403), OE forced manager
  - `/invites` with role OT requires the technician fields
  - seed idempotency (run twice, same counts)
- **Shared:** permission helpers and schemas.
- **Web:** MasterTable config rendering (read-only vs editable), the technician dialog, and the OT fields in the invite dialog.
- **E2E (Playwright, desktop and 360 px):**
  - An OM adds a final issue (billable), edits it and deactivates it, and sees it greyed out in the table.
  - An OM deactivates a location and confirms it's gone from the base-location select in the Add technician dialog (a lookups-driven select).
  - An OM adds a technician, the invite is accepted, and the technician appears with type and base location.
  - An OE sees only their own technicians.

## 6. Definition of done
- Migration applies cleanly on top of F01 data.
- Seed is idempotent.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm test:e2e` all pass.
- README is updated (the demo seed command).
- `test-report.md` includes a UAT checklist for every acceptance criterion in the intent.
