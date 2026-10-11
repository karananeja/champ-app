# F02 — Test Report

| | |
|---|---|
| Date | 2026-10-11 |
| Branch | `feature/F02-master-data` |
| Environment | macOS, Node 24.14, pnpm 10.33, Docker (postgres:16-alpine, pgsty/minio), Chromium (Playwright 1.64) |
| Result | **All gates pass**: typecheck, lint, build, 238 unit/integration tests, 12 E2E tests (1 skipped by design) |

## 1. Definition of done

| Step | Command | Result |
|---|---|---|
| Migrate (dev DB with F01 data) | `pnpm db:migrate` | `20261011160132_master_data` applied on top of `init`. The migration is additive only (new enums and tables, nullable columns on `User` and `Invite`); both existing users were kept |
| Seed, twice | `pnpm db:seed` ×2 | Both runs: "Super Admin … already exists, skipping" and "master data ready (80 lookup values, 8 activities, 6 make/models, 8 locations)". Same counts on the second run (idempotent) |
| Seeded values per kind | `psql` group-by | ASSET_TYPE 2, DEVICE_TYPE 1, INSTALLATION_TYPE 2, STATE 36, REGION 5, ISSUE_REPORTED 5, ISSUE_OBSERVED 5, ACTION_TAKEN 5, FINAL_ISSUE 5, ACCESSORY 6, CLOSE_REASON 2, SHIFT_TYPE 3, TASK_TYPE 3 |
| Run | `pnpm dev` | API on :4000, web on :5173 |
| Health | `curl localhost:4000/api/health`, `curl localhost:5173/api/health` | `{"ok":true,"db":"up"}` [200] both |
| Lookups | `POST /api/auth/login` (SA), then `GET /api/lookups` with the bearer token | 200, all 17 groups present with the counts above (activities 8, makeModels 6, locations 8, technicianTypes 3); task types `OT,TT,FT`; final issues with mixed billable flags |
| Lookups without a token | `GET /api/lookups` | 401 |
| Web | `GET localhost:5173/masters` | 200 |

The servers were stopped afterwards, and no processes were left running.

`pnpm db:seed:demo` was not run on the dev database, to leave it as it is. The script is idempotent and is covered
by the manual UAT step 8 below.

## 2. Quality gates

| Command | Result |
|---|---|
| `pnpm typecheck` | exit 0 (shared, api, web) |
| `pnpm lint` | exit 0: 0 errors, 0 warnings |
| `pnpm build` | exit 0 |
| `pnpm test` | exit 0: **238 passed / 0 failed** (shared 61, api 153, web 24) |
| `pnpm test:e2e` | exit 0: **12 passed / 0 failed / 1 skipped** |

### 2.1 Shared (`packages/shared`): 61 passed (F01: 41, new: 20)

| File | Tests | Covers |
|---|---|---|
| `test/masters.test.ts` (new) | 20 | `canEditMasters` for every role; `canEditTaskTypes` (SA, OM with and without delegation, others); `canEditLookupKind`; technician view/add/manage rules incl. OE own vs other; kind ⇄ slug mapping; name keys; master schemas (normalisation, blanks, references, update needs ≥1 field, active filter); technician schemas; `createInviteSchema` OT refinement (required for OT only, reported together with other field errors) |
| `test/roles.test.ts`, `test/password.test.ts` | 41 | unchanged from F01 |

### 2.2 API (`apps/api`, against `champ_test`): 153 passed (F01: 103, new: 50)

| File | Tests | Covers |
|---|---|---|
| `test/masters.test.ts` (new) | 28 | LookupItem CRUD (create, rename, deactivate, reactivate, list with `active` and `q`), unknown kind/id → 404, body validation, sort order (custom task types after OT/TT/FT); **duplicates, case-insensitive**, with a message naming the value; **system items** can't be renamed or deactivated (sortOrder still editable); **FINAL_ISSUE billable required** and togglable, ignored elsewhere; **activities** CRUD and asset-type filter, asset type required, **FK kind validation** (a STATE id as asset type → `INVALID_REFERENCE`), duplicate per asset type, **inactive asset type rejected** while existing activities keep it; **make/models** CRUD, search, duplicates; **locations** CRUD and state/region/search filters, same city in the same state rejected (other state allowed), swapped state/region kinds rejected, **inactive state/region rejected**, existing references kept; **`/lookups` returns only active values** (grouped, sorted; activities of inactive asset types excluded); auth required; **permission matrix** for SA, OM, OM with task-type delegation, OE, OT and RO on read and write of every master type; permission checked before validation; delegation takes effect immediately |
| `test/technicians.test.ts` (new) | 15 | **create**: OT invite carries name, phone, type, base location and manager; the accept page lookup returns the prefill; **accepting copies type and base location to the user**; the technician then lists with `baseLocation {id, city, state}` and `manager`; SA/OM must choose an OE; **OE is forced as manager**; validation, inactive/unknown base location, taken email; RO/OT can't create. **list**: SA/OM/RO see all OTs; **OE sees only own** (a `managerId` filter can't widen it); OT 403; filters type, base location, manager, status, search and pagination. **patch**: OM edits all fields; **OE patches others' technician → 403**; RO/OT 403; non-OT → 404; new base location must be active, an existing inactive one is kept; changing an OT to another role clears the technician profile |
| `test/seed.test.ts` (new) | 3 | **seed run twice gives the same counts**; every kind seeded; built-ins have codes and `isSystem`; LAF5 not a system item; 36 states/UTs; mixed billable; user deactivations survive a re-seed |
| `test/invites.test.ts` | 55 (F01: 51) | **`/invites` with role OT requires `technicianType` and `baseLocationId`** (400 with both field errors); fields stored and copied on accept; inactive base location rejected; ignored for other roles. Updated F01 cases: see §4 |
| `test/auth.test.ts`, `test/health.test.ts`, `test/users.test.ts` | 52 | unchanged from F01 |

### 2.3 Web components (`apps/web`): 24 passed (F01: 8, new: 16)

| File | Tests | Covers |
|---|---|---|
| `features/masters/MasterTable.test.tsx` (new) | 9 | Config rendering: columns incl. **Billable**, greyed-out inactive rows; **read-only (RO) vs editable (OM)**: no Add/Edit/toggle vs all controls; task types read-only for an OM without delegation; delegated OM: built-ins show the lock badge with disabled controls, custom ones are editable; add a final issue with the billable switch (validation first); server duplicate message on the field; **deactivate asks for confirmation** before the PATCH; search and state filter passed to the API |
| `features/technicians/TechnicianDialog.test.tsx` (new) | 5 | Required-field validation without an API call; OM picks the reporting OE (required), success shows the **one-time invite link view**; **OE has no manager select (forced to self)**; taken email shown on the field; edit prefills, keeps an inactive base location visible and PATCHes the changes |
| `features/invites/InviteDialog.test.tsx` | 6 (F01: 4) | F01 cases now fill the OT fields; new: **OT invite shows and requires technician type and base location**; fields hidden for other roles |
| `features/auth/LoginForm.test.tsx` | 4 | unchanged from F01 |

### 2.4 E2E (`apps/web/e2e`, Playwright, Chromium): 12 passed, 1 skipped

A new `setup` project (`org.setup.ts`) runs first. Through the API it creates an OM, two OEs and one technician
per OE, using a single SA login so the login rate limit (10 per 15 minutes per IP and email) isn't reached.

| Test | desktop (1280×720) | mobile-360 (360×740, touch) |
|---|---|---|
| `org.setup.ts`: test org via the API | ✓ (runs once) | — |
| `masters.spec.ts`: **OM adds a final issue (billable)**, a case-different duplicate is rejected with a clear message, edits it (rename, not billable), **deactivates it (confirm) and sees it greyed out** ("Inactive", `data-active=false`); no horizontal overflow | ✓ | ✓ |
| `masters.spec.ts`: OM adds a location (searchable state select), it appears in **Add technician → Base location**; **OM deactivates it, and it's gone from that select** ("No active location matches.") | ✓ | ✓ |
| `technicians.spec.ts`: **OM adds a technician** (type radio, searchable base location, reporting OE) → one-time link → **accepted in a separate browser session** with name/phone prefilled → the technician shows **Contractual, Pune, Maharashtra** and the OE | ✓ | ✓ |
| `technicians.spec.ts`: **an OE sees only their own technicians** (not the other OE's), has no reporting-OE filter, and edits their own technician's type | ✓ | ✓ |
| F01 `invite-flow.spec.ts`, `read-only.spec.ts` | ✓ ✓ | ✓, skipped by design |

## 3. Known limitations

- **Re-seeding brings back renamed dummy values.** The seed upserts on `(kind, code)` or `(kind, nameKey)` as the
  spec says, and leaves existing rows untouched. So a deactivated dummy value stays deactivated, but a renamed one
  is re-created under its original name on the next `pnpm db:seed`. Deactivate dummy values you don't want instead
  of renaming them, or don't re-run the seed after editing masters.
- **Technician profile for role changes (D-048).** F01 OTs created before F02, and users switched to OT through
  *Users → Edit role*, have no type or base location until someone sets them with *Technicians → Edit*. The
  Technicians page shows "—" for them.
- **Masters landing counts are active items only.** They come from `GET /lookups`, so no extra endpoint is needed.
- Master lists aren't paginated. They are small by nature (the largest seeded list is 36 states).
- On phones, toasts appear at the top (F01's `top-center` toaster) and cover the header, including the menu
  button, for about 4 seconds. Swipe a toast away to reach the menu sooner.
- Master edits refresh the lookups cache in the editor's browser straight away. Other signed-in users see the
  change within 10 minutes (the cache `staleTime`), or on a page reload.

## 4. F01 tests changed on purpose

The spec makes technician fields mandatory for OT invites, so these F01 tests changed:

- `apps/api/test/invites.test.ts`: OT bodies in the invite matrix, the manager-rule cases and the list case now
  include `technicianType` and `baseLocationId` (helper `technicianFields()`). The lookup response now also has
  `name` and `phone` (null for F01-style invites).
- `apps/web/src/features/invites/InviteDialog.test.tsx`: the OE→OT flow now picks a type and base location, and
  the request body includes them. Fixtures gained the new `UserDto` and `InviteDto` fields.
- `apps/web/e2e/helpers.ts`: `navigate` waits for closing dialogs to unmount and retries opening the mobile menu.
  `expectNoHorizontalScroll` now names the overflowing elements. While doing this, two layout issues came to
  light and were fixed: long emails now wrap in the Users, Invites and Technicians tables, and sonner's mobile
  toaster no longer overflows the viewport by 16 px.

## 5. UAT checklist (manual verification)

Setup: follow the README quick start, including `pnpm db:migrate` and `pnpm db:seed`. Optionally run
`pnpm db:seed:demo` for a demo OM, OE and three technicians (password `Demo@1234`). Open http://localhost:5173.
SA: `admin@intellicar.in` / `Admin@1234`. Use a private window per extra user.

| # | Acceptance criterion | How to verify | Automated coverage |
|---|---|---|---|
| 1 | A fresh seed shows every master with its dummy values | Sign in, then sidebar → **All masters**. There are 16 cards with counts (Asset types 2, Activities 8, Device types 1, Vehicle make/model 6, Installation types 2, States 36, Regions 5, Locations 8, Issues reported 5, Issues observed 5, Actions taken 5, Final issues 5, Accessories 6, Close reasons 2, Shift types 3, Task types 3). Open a few: Activities lists Vehicle (5) and Battery (3), Device types has only LAF5, Close reasons has "Client not available" and "Device has some issue". Run `pnpm db:seed` again: the counts don't change. | seed.test, §1 |
| 2 | An OM can add, edit and deactivate an item in any master; a deactivated item is hidden from the lookup endpoint but still listed (greyed out) | As an OM (invite one, or use `demo.om@intellicar.in`), open e.g. **Accessories** → **Add accessory** "GPS antenna" → Save. Click the pencil to rename it, then flip its switch → confirm **Deactivate**. The row stays, greyed out with "Inactive". In Locations, deactivate a city, then go to **Technicians → Add technician → Base location**: that city is no longer offered. Status filter *Active / Inactive / All* works. | masters.test (CRUD, /lookups active only), MasterTable.test, E2E masters ×2 |
| 3 | Built-in items can't be deactivated or renamed | As SA, open **Asset types**, **Shift types** and **Task types**. Vehicle/Battery, Day/Night/Early morning and OT/TT/FT have a **Built-in** lock badge, and their switch and pencil are disabled. (API: `PATCH` on them with a new name or `active:false` → 409 `SYSTEM_ITEM`.) | masters.test (system items), MasterTable.test |
| 4 | Duplicate names in the same master (and the same city in the same state) are rejected with a clear message | Add "relay" in Accessories: you get *"Relay" already exists in Accessories*. In Locations, add "bengaluru" with state Karnataka: *Bengaluru already exists in Karnataka*. The same city in another state is accepted. | masters.test (duplicates), E2E masters |
| 5 | An activity must belong to an asset type; filtering by asset type works | **Activities → Add activity**: saving without an asset type shows "Choose an asset type". Use the **All asset types** filter → Battery: only the 3 battery activities show. | masters.test (activities), shared masters.test |
| 6 | A final issue's billable flag can be toggled and shows in the table | **Final issues**: the Billable column shows *Billable / Not billable*. Edit one, flip **Billable**, then Save: the column updates. Adding a final issue always sends a billable value (the switch defaults to off). | masters.test (billable), MasterTable.test, E2E masters |
| 7 | Task types: an OM without delegation sees them read-only; after SA delegates task types, that OM can add one | As the OM, open **Task types**: there's a "View only" badge, and no Add, switches or pencils. As SA: **Users** → the OM's "…" → **Delegation…** → turn on *Delegate task types*. As the OM, reload: **Add task type** appears. Add "Audit": it is listed after OT, TT and FT. | masters.test (permission matrix, delegation), MasterTable.test |
| 8 | Add technician creates an OT invite with type, base location and reporting OE; accepting it gives an OT whose details show on the Technicians page | As OM: **Technicians → Add technician**. Fill name, contact number and email, pick type *Contractual*, base location *Pune, Maharashtra* (type to search) and a reporting OE, then **Create invite**. Copy the one-time link and open it in a private window: name and phone are prefilled. Set a password. Back on Technicians (reload), the new row shows Contractual, Pune, Maharashtra, the OE and Active. The same fields appear in **Users → Invite user** when the role is *Operations Technician*. | technicians.test, invites.test (OT fields), TechnicianDialog.test, InviteDialog.test, E2E technicians |
| 9 | An OE sees and edits only their own technicians; RO sees everything with no edit actions | As an OE (e.g. `demo.oe@intellicar.in` after the demo seed): Technicians shows only their OTs, there's no "Reporting OE" filter, and the pencil edits type, contact and base location. *Add technician* has no manager select ("Reports to: you"). As an RO: every technician is listed with no Add button or pencils, and every master shows "View only" with no controls. | technicians.test (OE scope, 403s), masters.test (matrix), E2E technicians |
| 10 | All screens work at 360 px; automated tests pass | In devtools, pick a 360 px wide device. Masters, each master list (cards), Technicians (cards) and the dialogs fit with no horizontal scrolling, and the searchable selects open inside the dialog. Run `pnpm test` (238 passed) and `pnpm test:e2e` (12 passed, 1 skipped). | E2E mobile-360 (overflow checks), §2 |
