# Champ

Device fitment operations platform: an Operations Console (web), a Field App (mobile, from F09) and a single API.
Requirements and decisions live in [`docs/`](docs/) (start with `docs/requirements/01-requirements-spec.md` and
`docs/decision-log.md`).

## Stack

pnpm workspaces, TypeScript everywhere.

| Path | What |
|---|---|
| `apps/api` | Express 5 + Prisma 7 (PostgreSQL), zod validation, JWT access + rotating refresh tokens, pino logging |
| `apps/web` | React 19 + Vite + Tailwind 4 + shadcn/ui, React Router, TanStack Query, React Hook Form |
| `apps/mobile` | Field app (F09): Expo SDK 57 / React Native 0.86, expo-router, TanStack Query, React Hook Form, MapLibre with OSM tiles; a development build, not Expo Go |
| `packages/shared` | Roles, permission matrices, zod schemas and DTO types used by both apps |
| `docker-compose.yml` | PostgreSQL 16 (`localhost:5432`) and MinIO (`localhost:9000`, console `:9001`) |

## Quick start

Prerequisites: Node 24+, pnpm 10+, Docker.

```bash
cp .env.example .env        # defaults work as-is for local development
docker compose up -d        # PostgreSQL + MinIO
pnpm install
pnpm db:migrate             # apply migrations (and generate the Prisma client)
pnpm db:seed                # create the first Super Admin and the master data (dummy values)
pnpm db:seed:demo           # optional: a demo OM, OE and three sample technicians
pnpm dev                    # API on :4000, web on :3000
```

Open http://localhost:3000 and sign in with the seeded Super Admin:

- Email: `admin@intellicar.in`
- Password: `Admin@1234`

(Change them with `SEED_SUPERADMIN_EMAIL` / `SEED_SUPERADMIN_PASSWORD` in `.env` before seeding.)

The web dev server proxies `/api` to the API, so the refresh cookie is same-origin. Check the API with
`curl http://localhost:3000/api/health`.

### Inviting users

There is no email delivery in the MVP. On **Users → Invite user**, the app shows a one-time invite link to copy
and share. It works once and expires after 72 hours. The invitee opens it, sets name, phone and password, and is
signed in.

| Role | Can invite |
|---|---|
| Super Admin (SA) | any role |
| Operations Manager (OM) | OE, OT, RO |
| Operations Executive (OE) | OT (as their own reportee) |

Inviting an OT also needs a technician type and base location (F02); the Technicians page does the same with
name and contact prefilled for the invitee.
| Operations Technician (OT), Read Only (RO) | — |

### Master data and technicians (F02)

**Masters** (sidebar → *All masters*) holds the 16 lists behind every dropdown: asset types, activities, device
types, vehicle make/model, installation types, states, regions, locations, issues reported/observed, actions
taken, final issues (with a billable flag), accessories, close reasons, shift types and task types. `pnpm db:seed`
fills them with dummy values (D-017) that you can rename or replace. Values are never deleted, only deactivated:
an inactive value disappears from dropdowns (`GET /api/lookups`) but stays in the admin list, greyed out.
Built-in values (asset types Vehicle/Battery, shift types, task types OT/TT/FT) can't be renamed or deactivated.

Only SA and OM see the Masters menu and pages (and `/api/masters/*`; other roles get 403 and are sent to the
dashboard, CR-01 / D-059). SA and OM can edit masters; task types need SA, or an OM with *Delegate task types*.
Every signed-in user still gets the active values for dropdowns from `GET /api/lookups`.

**Technicians** lists every OT with type, base location and reporting OE. *Add technician* creates the OT's
invite (same one-time link as above). An OE only sees and edits their own technicians.

`pnpm db:seed:demo` (after `pnpm db:seed`) adds `demo.om@intellicar.in`, `demo.oe@intellicar.in` and three OTs
(`ravi.ot@`, `suresh.ot@`, `amit.ot@intellicar.in`), all with the password `Demo@1234`, plus two sample clients
(F03). It skips accounts and clients that already exist (and the demo tasks once any `[demo]` task exists).

### Clients and sites (F03)

**Clients** (sidebar) lists customers with code, primary contact, sites (active/total) and status; SA and OM can
add and edit them, OE and RO see them read-only, OT can't open the page. *Add client* is a full page: client
fields first, then one or more **sites**. Each site has a name, an address and an exact **map pin**: search an
address (results come from OpenStreetMap's Nominatim, through the API) or tap the map and drag the pin; the
address is filled in by a reverse lookup unless you typed it yourself, and the **City** (from the Locations
master) is suggested from the pin. A client always keeps at least one active site. Clients and sites are never
deleted, only deactivated; inactive ones are greyed out and left out of `GET /api/lookups` (used by the task form
from F04).

Geocoding is proxied by the API (D-054): at most 1 request a second to Nominatim, an identifying `User-Agent`, and
an in-memory cache (500 entries, 24 h). If Nominatim can't be reached, the page says so and you can still place
the pin and type the address by hand. Map tiles load straight from `tile.openstreetmap.org` (D-020).

| Variable | Default | What |
|---|---|---|
| `NOMINATIM_URL` | `https://nominatim.openstreetmap.org` | Geocoder base URL (point it at a self-hosted Nominatim later) |
| `OSRM_URL` | `https://router.project-osrm.org` | Route planning for the field app (F10); point it at a self-hosted OSRM for production |
| `GEOCODER_CONTACT_EMAIL` | `admin@intellicar.in` | Contact sent in the `User-Agent` (`Champ/0.1 (<email>)`), as the OSM usage policy asks |

`pnpm db:seed:demo` also adds two sample clients (*Demo Fleet Rentals* with sites in Bengaluru and Pune, *Demo
Logistics* in New Delhi), with hard-coded coordinates.

### Tasks (F04)

**Navigation (CR-10):** the sidebar has a single **Tasks** item: it opens the Board for SA and OM and the Open list
for everyone else. The task views are tabs at the top of the Tasks page: Board (SA/OM), Open, Assigned (OE),
Awaiting approval (SA/OM), Re-opened, Faulty, Completed, All, Travel. Each keeps its own URL (e.g. `/tasks/faulty`,
`/tasks/travel?tt=…`); on phones the tab bar scrolls sideways. **Create task** and **Bulk upload** are at the top right
of the Open tab (task creators).

The **Tasks** menu (SA, OM, OE and RO; not OT) holds *Create task*, *Bulk upload* (creators only), *Open tasks*,
*Assigned* (OEs: tasks where they are the operation executive), *Awaiting approval* (SA/OM), *Completed tasks*
(latest completion first) and *All tasks* (every status; CR-04), *Faulty tasks* and *Re-opened* (F05, below) and
*Travel tasks* (F08, below).

- **Create task** is a full page: customer → site (the fitment city comes from the site), POC prefilled from the
  customer's primary contact, operation executive (locked to yourself as an OE), optional technician type and
  technician, asset type → activity, device type (LAF5 by default), make/model (vehicles only), installation type,
  requested and fitment date-time **in IST** (calendar date-time picker: day, hour, minute in 5-minute steps; CR-04),
  shift, issue reported, GPS address and comments. Vehicles are either a
  count or a CSV (`registration_number, chassis_number, asset_number, old_device_id`, all optional, up to 500 rows;
  sample on the page).
- Saving creates the task with an **OM id** (`OM-00001`), an **OE id** (`OE-00001`) and **one fitment per vehicle**
  (`TK-00001`, …). With a technician every fitment starts *Assigned* to them, otherwise *Open*. On the task page,
  tick fitments and assign or unassign them (any active technician) while they are Open, Assigned or Reopened, and edit
  vehicle details (edit locks, F05).
- **Edit** (the task's OE only while no fitment has started; SA/OM at any stage, F05) and **Delete** (SA/OM; soft
  delete, kept in the audit log) only while no fitment has started.
- **Bulk upload**: download the sample, upload a CSV (one row per task, `vehicle_count` vehicles; customer code or
  name, site name, emails and master names; dates `YYYY-MM-DD HH:mm` IST; ≤ 2 MB, ≤ 1,000 rows), check the preview
  (bad cells in red with the reason), import the valid rows and download the error rows to fix.
- Lists filter by customer, OE, technician, status, activity and a fitment date range (one calendar control), search ids (`OM-00001`, `tk-1`, `12`),
  customer or POC, and **Download** CSV or Excel with the current filters (up to 10,000 rows).

Every change writes a `TaskEvent` row (audit trail for F05's history). Sample CSVs for UAT are in
[`docs/features/F04-task-creation/samples/`](docs/features/F04-task-creation/samples/).

`pnpm db:seed:demo` also adds three demo tasks (comments start with `[demo]`): one Open, one Assigned and one split
between two technicians.

### Workflow: approvals, reopen, faulty and history (F05)

Each fitment moves through one shared state machine (`packages/shared/src/workflow.ts`, used by the API and the
web): **Assigned → In progress → Submitted** (technician) **→ OE verified** (the task's OE) **→ OM approved** (SA/OM),
with the side paths **Closed – not done** (close reason + comments), **Moved to FT** (faulty device: a new Open
replacement fitment with its own TK id is added to the same task) and **Reopened** (reason required; OE or OM; goes back
to the same technician, who can be changed). Steps out of order are refused with a clear message (409
`INVALID_TRANSITION`). The task status follows its fitments (Open → Assigned → In progress → Completed).

- **Task page:** a status badge per fitment and the actions you may take (*Verify*, *Final approve*, *Reopen*), the
  close/fault reason, replacement links and a reopen counter. OMs can tick OE-verified fitments and final-approve them
  together. On phones each card has an actions menu.
- **Edit locks:** the technician may change fitment data until the OE verifies, the OE until the OM approves, SA/OM
  at any stage (a change after approval is flagged `postApproval` in the history). SA/OM can also edit the task header
  after work started (flagged `postStart`); an OE only before.
- **Lists:** *Awaiting approval* (SA/OM, with bulk final approve), *Re-opened* (count, latest reason, who, current
  status) and *Faulty tasks* (fault reason, replacement and its status). OEs see only their own tasks; RO reads.
  Reopens are also stored per person (`ReopenAttribution`: an OE reopen counts against the technician; an OM reopen of
  an OE-verified fitment against the OE and the technician) for the analytics in F15.
- **History tab** (SA/OM): the stage timeline (First → Second → Verification → Final) of the task and each fitment,
  with reopen loops, and the raw event log with before/after values, filterable and downloadable as CSV.

**Simulate technician (dev only).** Until the mobile app (F10) exists, the task page shows a *Simulate technician
(dev only)* panel to SA, OM and the task's OE: pick a fitment, then *Start work* (at the site's location), *Submit*,
*Close not done* or *Mark faulty*. It calls `POST /api/dev/fitments/:fid/simulate`, which acts as the fitment's assigned
technician; its events are flagged `simulated`. The API mounts the route only when enabled and never with
`NODE_ENV=production`; the web panel is loaded only in a Vite dev build, and `pnpm build` checks that the production
bundle has no trace of it.

| Variable | Default | What |
|---|---|---|
| `ENABLE_DEV_SIMULATOR` | unset → on in development, off otherwise (`true` in `.env.example`) | Mounts the technician simulator API; ignored (always off) when `NODE_ENV=production` |

### OE verification and photos (F06)

- **Verify** on a Submitted fitment opens the **verification sheet** (right side on desktop, full screen on phones):
  the technician's work on the left (technician, OT remarks, photos) and the form on the right: *Issue observed at
  site*, *Action taken*, *Accessories* (checkboxes), *Remarks from OE*, a *Debug image* upload (drag-and-drop or picker)
  and the *Final issue* with a live **Billable: Yes/No** badge. *Save draft* keeps partial entries; *Verify* needs
  issue observed, action taken and final issue (D-098) and shows what is missing. Only active master values are
  offered; a saved value deactivated later shows as "(inactive)".
- **Billable** is snapshotted from the final issue's flag when the fitment is verified, and again only when its final
  issue is changed later (D-101). Changing the flag in Masters doesn't touch verified fitments; a reopen clears it until
  the next verification.
- **Who:** the task's OE edits the verification while Submitted or OE verified; an OM also after approval (flagged
  `postApproval` in the history). SA and RO only view. Verified fitments show the final issue and billable badge in
  their row, and the button becomes *Edit verification* or *View verification*.
- **Photos:** *Photos (n)* opens a viewer grouped by kind (Before, Asset, Cluster reading, Device/SIM placement, After,
  Debug image) with a zoomable lightbox (keyboard and swipe). The OE (until OM approval) and the OM can **Replace** a
  photo or **Remove** it, with a reason; the original is never deleted (D-100) and shows under **Show history** (SA, OM
  and the task's OE), greyed out with who, when and why. Uploads accept JPEG, PNG or WebP up to 10 MB; the server checks
  the real type from the file's bytes.
- **Simulator:** *Submit* now also stores five labelled sample photos and sample OT remarks
  (`apps/api/src/modules/dev/sample-photos/`).
- **Lists and export:** Completed and All tasks show a **Billable** column (billable / verified fitments, e.g. "3 / 5").
  The Download menu adds **Fitments (CSV)** and **Fitments (Excel)** (`/api/tasks/export?level=fitment`): one row per
  fitment with issue observed, action taken, accessories, final issue, billable, verified and approved times. The task
  export gains *Verified fitments* and *Billable fitments*.
- Every verification save and photo change is in the History tab with before/after values.

**Storage (D-102).** Photos live in a **private** S3 bucket (MinIO locally). Uploads go through the API; browsers read
photos through presigned GET URLs valid for 10 minutes (the photo list refreshes every ~8 minutes and on window focus).
The API creates the bucket at start if it is missing (a storage outage is logged; photo calls then fail with 503
`STORAGE_UNAVAILABLE`). Object keys are `fitments/{fitmentId}/{photoId}.{ext}` (F08 travel receipts: `travel/{travelTaskId}/{attachmentId}.{ext}`). Tests use an in-memory driver; E2E uses
the real MinIO with its own bucket `champ-e2e`.

| Variable | Default | What |
|---|---|---|
| `STORAGE_DRIVER` | `s3` | `s3` or `memory` (tests) |
| `S3_ENDPOINT` | — | S3/MinIO endpoint the API uses (`http://localhost:9000` locally) |
| `S3_PUBLIC_URL` | `http://localhost:9000` | Endpoint used to sign GET URLs: must be reachable from the browser |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | — | Required for `s3` (`champ` / `champchamp` with docker compose) |
| `S3_BUCKET` | `champ` | Photo bucket (kept private) |
| `S3_REGION` | `us-east-1` | Signing region (any value works with MinIO) |

### OM kanban board (F07)

**Tasks → Board** (`/tasks/board`, SA and OM only; other roles get the 403 page and `/api/board*` answers 403) shows
**one card per fitment** (D-109): six main columns following the flow, **Open → Assigned → In progress → Submitted →
OE verified → OM approved**, and a collapsible **Other** area with the side lanes **Reopened**, **Closed – not done**
and **Moved to FT** (collapsed by default, with counts, and still drop targets). Each card shows the TK id, OM id,
customer and city, activity, technician (or *Unassigned*), fitment date (IST) and badges (reopen ×N, Billable
Yes/No once verified, Replacement of TK-…). Columns are ordered by fitment date, then TK number (D-110), load 50
cards at a time with **Load more**, and the finished columns (OM approved, Closed – not done, Moved to FT) show
only the **last 7 days** by their status time unless a fitment-date range is set (D-111).

- **Moving cards.** Drag a card (or several ticked cards of one column; Shift-click ticks a range) onto another
  column. Only these moves exist (`boardMove` in `packages/shared/src/board.ts`, D-113): Open → Assigned asks for
  the technician, Assigned → Open confirms the unassign, OE verified → OM approved confirms the final approval
  (several at once), and Submitted / OE verified / Closed – not done → Reopened asks for the reason. While dragging,
  columns the card can't go to are greyed out; dropping there shows why (e.g. "Only the technician can start or
  submit work") and the card snaps back. Moves call the existing endpoints (assign, bulk approve, transitions), move
  the cards at once and roll back with the server's message if something fails.
- **Keyboard:** Tab to a card, **Space** picks it up, the **arrow keys** step through the columns, **Space** drops,
  **Escape** cancels; **Enter** opens the quick view.
- **Quick view:** clicking a card opens a side sheet (full screen on phones) with the fitment summary, verification
  summary and photos, the actions you may take (*Change technician* — reassigning lives here, D-112 — *Final
  approve*, *Reopen*) and a link to the task.
- **Refresh:** the board refetches every 30 seconds and when you return to the tab (paused while you drag or a
  dialog is open), so the simulator's or an OE's changes show up without reloading. Instant updates come with F13.
- **Filters** (customer, OE, technician, activity, fitment date range, TK/OM/OE id) live in the URL, so a filtered
  board can be shared and reloaded.
- **Phones:** one column at a time, chosen with the column picker (with counts) or by swiping; each card has a
  **Move to…** menu listing only the allowed targets, which opens the same dialogs.

API: `GET /api/board` (all nine columns: `{ columns: { STATUS: { count, items, hasMore } } }`) and
`GET /api/board/:status?page=N` (Load more), both with `clientId, oeId, technicianId, activityId, from, to, q,
pageSize` (default 50, max 100). One `groupBy` for the counts and one query per column, whatever the number of
cards.

### Travel tasks (F08)

A **travel task** (`TT-00001`) records a technician's trip outside a planned fitment (picking up a faulty device,
replacing a device, fixing an issue, an ad-hoc visit) so it can be verified for reimbursement. The money itself is
calculated outside Champ (D-018). Rules live in `packages/shared/src/travel.ts` and are used by the API and the web.

- **Fields** (D-119): technician, location (Locations master), customer (optional), purpose (3–1,000 characters),
  travel date (IST day, not in the future), related task (optional TK id, any technician's fitment), distance in km
  (optional, 0 < km ≤ 5,000, one decimal) and receipts (optional; JPEG/PNG/WebP images or PDF, up to 10 MB each, at
  most 10 per TT).
- **Who raises:** SA and OM for any technician, an OE for their own technicians (on the web, *Raise travel task*;
  the technician is preset and hidden when there is only one), an OT for themselves (the API is ready for the field
  app, F09/F10; source `MOBILE`).
- **Flow** (D-120, D-121): **Raised → Verified** (by the technician's OE or any OM; SA only views) or **Raised →
  Rejected** (reason required). The person who raised it (or an OM) can edit and **Resubmit** a rejected TT, with the
  edits in the same step; the rejection stays in the history. A verified TT is **locked**; an OM can **Reopen** it
  with a reason. Every change (fields with before/after values, reasons, receipts added or removed) is in the TT's
  history.
- **Who sees what:** SA, OM and RO all TTs; an OE the TTs of technicians who report to them; an OT their own. RO is
  read-only.
- **Tasks → Travel tasks** (`/tasks/travel`): table (cards on phones) with filters for technician, OE (not shown to an
  OE), customer, location, status, travel date range and TT id search, all kept in the URL; **Download** CSV or Excel
  (current filters, up to 10,000 rows, every field and the status). Clicking a TT opens its **detail sheet**
  (`?tt=<id>`): every field, receipts (images in the F06 photo viewer, PDFs as chips that open in a new tab), the
  history and the buttons you may use (*Verify*, *Reject*, *Resubmit*, *Reopen*, *Edit*). Receipts are added in the
  raise dialog (uploaded right after the TT is saved, with progress) or later in the sheet, and removed there (the
  file is kept, as D-100).
- **Dashboard:** OMs and OEs get a **Travel to verify** card (Raised TTs; an OE only their technicians') that opens
  `/tasks/travel?status=RAISED`.

API: `GET /api/travel-tasks/options`, `GET/POST /api/travel-tasks`, `GET/PATCH /api/travel-tasks/:id`,
`POST /api/travel-tasks/:id/transitions` (`{ action: VERIFY | REJECT | RESUBMIT | REOPEN, reason?, changes? }`),
`POST /api/travel-tasks/:id/attachments` (multipart `file`; the role and the TT rule are checked before the file is
read) and `…/attachments/:aid/remove`, `GET /api/travel-tasks/export?format=csv|xlsx`, and `GET /api/fitments/lookup?q=`
(up to 10 fitments by TK id or number, for the related-task picker). Receipts are stored in the same private bucket
as photos under `travel/{travelTaskId}/{attachmentId}.{ext}`.

### Field app (F09)

The field app (`apps/mobile`, "Champ Dev" while developing) is for **technicians (OT) and OEs** only; SA, OM and RO
are told to use the web console (D-128). It's online only (D-008). Bottom tabs: Home, Route, History and Profile, each with an icon (CR-08).

- **Sign in** with the same email and password as the web. The session survives app restarts: the refresh token is
  kept in the phone's secure storage and the access token in memory (D-133). *Sign out* is on the Profile tab.
- **Home location** (D-129): an OT must set one at first sign-in, by GPS (*Use my current location*), address search
  or moving the map under the centre pin; the address is filled from the pin and can be edited before *Save*. An OE
  may *Skip*. It can be changed from Profile. On the web it shows (read-only) on the Technicians page.
- **Home**: a date chip (today and the 7 days before it, D-029), a notifications bell (F13), **Show tasks**
  (your fitments that day) and, for an OE, **Approve visit** (submitted fitments that day waiting for you; the screen
  comes in F12). Pull to refresh.
- **Route** (F10): your fitments for the chosen date in the best visiting order (OSRM trip, D-015), from your current
  position, or from home when location is off (with a notice, D-155). It shows a map with the route line and numbered
  stops, and a timeline with the distance and drive time from the previous stop. Finished stops come first, ticked.
  The order is kept until you tap *Recalculate route* (needs GPS) or the day's open fitments change. If routing is
  unavailable it falls back to straight-line nearest-first ("Approximate order").
  The ◎ **Locate me** button on the map shows where you are and moves the map there, without changing the route
  (CR-07).
- **One at a time** (D-156): only the next open stop can be started (an In-progress one is always next); the server
  refuses another with 409 `ROUTE_ORDER`. To skip a stop, close it. *Close* and *Mark faulty* aren't order-restricted.
  Fitments of the **same task** never block each other (D-202, F11): they're at the same site and can be in progress
  together; fitments of other tasks still follow the order.
- **Fitment screen** (`/fitment/[id]`): site map, customer, site, vehicle, activity, asset and installation type, time,
  the OE (tap to call) and *Directions* (Apple Maps on iOS, Google Maps navigation on Android). Actions:
  - **Start** needs a fresh GPS fix (no fix → it explains why and offers *Open settings*); the start position and
    time are recorded (no distance check, D-157). Then **Continue or Close**: *Yes, continue* shows the fitment-form
    placeholder until F10B; *No, close* asks for a reason (Close reasons master) and comments.
  - **Close (not done)** also works before starting; **Mark faulty** (reason) moves the fitment to FT and the OE gets
    the replacement (D-012).
- **Fitment form** (F10B; *Yes, continue* or *Open form*): before, asset, cluster (vehicles), device/SIM placement
  (when replaced) and after photos; five checks (OK / Not OK / Not applicable); reg no., chassis no., cluster reading
  (km); device replacement (Device / SIM / No); device id and secondary device id; comments. It saves as you go (fields
  on blur, photos straight away; "Not saved — retrying" if the connection drops). *Submit* lists anything missing
  (D-180–D-183); then the **summary** opens, and *Edit* works until the OE verifies (D-184). The OE sees the answers in
  the "Technician's form" section of the web verification sheet, and edits after submit show in the history.
- **Photos**: *Take photo* or *Choose from gallery*; each is resized to 1600 px, JPEG-compressed and stamped with the TK
  id, IST date/time and GPS position burned into the image (D-181, D-198). *Retake* replaces it (the old one stays in
  the history).
- **Scan** (device ids): reads barcodes and QR codes live, or *Read text* recognises printed text on the device and
  offers the candidates; the technician confirms or edits (D-023, D-200). The iOS Simulator has no camera: use the
  gallery there, the Android emulator's virtual camera, or a phone.
- **Bulk fill (CSV)** (F11, D-201–D-205): when you have 2 or more fitments in one task, the fitment screen shows
  *Bulk fill (CSV)* and the route shows a *Bulk fill* link on that task's first stop. The bulk screen lists your
  fitments of the task with their progress ("Form ✓ · Photos 2 of 4 · In progress") and what each still misses.
  1. *Download sample CSV* shares a file (Files, Drive, email…) with one row per fitment: `tk_id` and the reg/chassis
     already filled. Fill it in Sheets, Excel or Numbers and export it as CSV.
  2. *Upload CSV* shows a **preview**: valid rows in green with the values that will be filled, rows with problems in
     red with the reason per cell, and "18 ready, 2 with problems · 6 will be started". Nothing is saved yet.
  3. *Confirm* fills only the valid rows and **starts** the fitments not started yet with one GPS fix (refused
     without location). A **blank cell keeps the existing answer**; a filled one overwrites it. Each filled fitment's
     history records "Filled from CSV" with what changed.
  4. *Add photos* walks through the missing photos fitment by fitment (before → asset → cluster → placement → after),
     with *Skip* and *Next*. A CSV carries no photos (D-203).
  5. *Submit ready (n)* submits every In-progress fitment of the task that has nothing missing and lists the rest with
     what they still need (D-204). Each fitment can still be opened and submitted on its own.

  CSV columns (only `tk_id` is required; a missing column counts as blank and unknown columns are ignored; at most 500
  rows and 1 MB):

  | Column | Values |
  |---|---|
  | `tk_id` | `TK-00012`, `tk-12` or `12` |
  | `vehicle_reg_no`, `chassis_no` | Text, max 32 |
  | `cluster_reading_km` | Whole number 0–9,999,999 (`1,200` is fine) |
  | `asset_condition`, `accessories`, `vehicle_battery_condition`, `cluster_meter_reading`, `can_voltage` | OK / Not OK / NA (also N/A, Not applicable; any case) |
  | `device_replacement` | Device / SIM / No |
  | `device_id`, `secondary_device_id` | Text, max 64 (upper-cased) |
  | `comments` | Text, max 1000 |
- **History** tab (F12, D-216–D-218): the chosen day as a timeline, each fitment with its steps that day (Started,
  Submitted, Closed – not done with the reason, Moved to FT) in IST and the drive distance from the previous one. The
  top shows the day's total, e.g. "42.6 km · 6 fitments": the OSRM driving distance through the **start positions** of
  the fitments started that day, in start order (no home leg; same site or < 50 m apart = 0 km); "≈ … (approx.)" when
  routing was unavailable (straight lines). Tap a fitment → its summary. An OE also gets **Direct reportees**
  (technicians whose manager they are) with each one's count and distance; tap → their day, read only. Distances are
  cached per user and day (`DayDistance`) and recomputed when the starts change; the reportees list never calls OSRM.
- **Approve visit** (OE, F12, D-014, D-219): the Home tile opens the Submitted fitments of your tasks for the date
  (the same as its count). A fitment shows the technician's form and photos, then **Issue observed, Action taken and
  Final issue** (required, D-098; the final issue shows Billable/Not billable), accessories and OE remarks. *Verify*
  or *Reopen* (with a reason) use the same endpoint and rules as the web, then the next waiting fitment opens.
  Replacing photos and the debug image stay on the web (D-220).
- **OEs doing fitments** (D-158): on the web an OE can assign a fitment of their own task to themselves, and an SA/OM
  can assign any fitment to an OE ("Name (OE)" in the assign dialog). The OE then works it in the app like a
  technician.
- **Notifications** (F13): the header bell shows the unread count and opens the Notifications screen; live while the
  app is open (toast), caught up when it returns to the foreground. See *Notifications* below.
- **Profile**: your details, your manager (tap the phone to call), home location, app version and *Sign out*.
- With the API unreachable the app shows **No connection** with *Retry*.

**Run it** (Xcode with an iOS Simulator and/or Android Studio with an emulator; the API must be running, `pnpm dev`):

```bash
cd apps/mobile
npx expo run:ios                # first time: native build + install on the iOS Simulator (several minutes)
npx expo run:android            # first time: with an Android emulator running
pnpm --filter @champ/mobile start   # afterwards: Metro only, then open "Champ Dev" on the device
```

- The app finds the API on the machine that serves Metro, port 4000 (`localhost` on the iOS Simulator, `10.0.2.2`
  on the Android emulator, the Mac's Wi-Fi IP on a phone). Set `EXPO_PUBLIC_API_URL=http://<mac-ip>:4000` to
  override it, then restart Metro.
- **On a phone** (same Wi-Fi as the Mac): `npx expo run:android --device`, or `npx expo run:ios --device` (needs
  Xcode signing with your Apple ID as a personal team).
- F10B added native modules (camera, image picker and manipulator, file system, Skia, text extractor): after pulling
  it, run `pnpm install` and rebuild with `npx expo run:ios` / `npx expo run:android`.
- F11 added `expo-document-picker` and `expo-sharing`: rebuild the dev clients after pulling it.
- `ios/` and `android/` are generated and not committed; delete them and run `expo run:*` again after changing
  `app.config.ts` or adding a native module. `APP_VARIANT=production` builds the `in.intellicar.champ` id instead of
  `in.intellicar.champ.dev`.
- Map tiles come from `tile.openstreetmap.org`, which is fine for development only (its usage policy); production
  needs another tile provider.

API (field app): `POST /api/mobile/auth/login` (`{email, password}` → `{accessToken, refreshToken, user}`, no
cookie; same rate limit as the web login), `POST /api/mobile/auth/refresh` and `/logout` (`{refreshToken}`),
`GET /api/mobile/home?date=YYYY-MM-DD`, `GET /api/mobile/fitments?date=` and `PUT /api/me/home-location`
(`{lat, lng, address}`); all for OT and OE. `/api/geo/search` and `/reverse` now also allow OT and OE. `UserDto` and
technician rows include `homeLocation`.
F10: `GET /api/mobile/route?date=&lat=&lng=` (stored per technician and day as `DayRoute`, D-155),
`POST /api/mobile/route/recalculate` (`{date, lat, lng}`), `GET /api/mobile/fitments/:fid`; the technician steps go
through the existing `POST /api/fitments/:fid/transitions`. F10B: `PUT /api/mobile/fitments/:fid/form` (partial; `null` clears) and
`POST /api/mobile/fitments/:fid/photos` (multipart `file`, `kind`, `lat`, `lng`, `takenAt`); SUBMIT is refused with 400
`FORM_INCOMPLETE` (`details.missing`) until the form is complete. The dev simulator fills the form before submitting. F11 (OT/OE, 404 for a task without your fitments):
`GET /api/mobile/tasks/:taskId/bulk-fill` (your fitments with `missing` and `missingPhotos`),
`GET …/bulk-fill/sample.csv`, `POST …/bulk-fill/preview` (multipart `file`; writes nothing),
`POST …/bulk-fill/confirm` (`{rows: [{rowNumber, tkId, form}], lat?, lng?}` → `{filled, started, failed}`; 400
`GPS_REQUIRED` when a row needs starting without a fix) and `POST /api/mobile/tasks/:taskId/submit-ready`
(→ `{submitted, incomplete, skipped}`). `MyFitmentDto.taskFitmentCount` drives the *Bulk fill* entry. F12 (OT/OE): `GET /api/mobile/history?date=&userId=`
(yourself, or an OE's direct reportee; else 403), `GET /api/mobile/history/reportees?date=` (OE),
`GET /api/mobile/approve-visit?date=` and `GET /api/mobile/approve-visit/:fid` (OE, own tasks; else 404); Verify and
Reopen go through `POST /api/fitments/:fid/transitions` (`{action, payload}`). `OSRM_URL` (default `https://router.project-osrm.org`, the
public demo server: fine for development only) sets the routing service; tests and E2E point it at an unreachable
address, so they use the straight-line fallback.

### Global search (F14)

**Ctrl/⌘ K**, or the search box in the top bar (an icon on phones), for SA, OM, OE and RO. Type an id and the results
appear grouped by task, each saying which identifier matched (highlighted); Enter or a click opens the task, the
fitment's verification sheet (`/tasks/:id?fitment=`) or the travel task. *Show all results* opens `/search?q=` (up to 100).

- **OM, OE, TK and TT ids** match exactly: prefix and case optional, with a space, hyphen or nothing after the prefix,
  leading zeros optional (`OM-00045`, `oe 45`, `tk-112`). A bare number finds OM, OE and TK ids; TT ids need `TT`.
- **Device id, secondary device id, old device id, chassis no., asset no. and vehicle reg. no.** match by "contains"
  from 3 characters, ignoring case, spaces and hyphens (Postgres trigram indexes on the normalized values).
- Ranking: exact ids first, then the identifier's order in the settings, then an exact value before a partial one,
  then the newest task. Deleted tasks never show; travel tasks follow the travel list's visibility (D-242–D-246).
- **Settings → Search identifiers** (SA only): switch each of the ten identifiers on or off and set the ranking order
  (at least one stays on).

API: `GET /api/search?q=&limit=` (`{q, hits, total, truncated}`; default 20, max 100), `GET /api/search/identifiers`
and `PUT /api/search/identifiers` (`{items: [{identifier, enabled}]}`, all ten in ranking order; SA only).

### Notifications (F13)

A **bell** in the web top bar (every role) and in the app header shows the unread count; opening it lists the latest
notifications (newest first, unread highlighted, "5 min ago" then IST date/time) with *Mark all as read*. Tapping one
marks it read and opens what it's about: on the web the task, with the fitment's verification sheet when you can
verify it (`/tasks/:id?fitment=<id>`), or the travel task; in the app the fitment (technician) or the fitment in
Approve visit (OE). While the page or app is open, new ones arrive live with a small toast (D-230, D-232); otherwise
they wait for the next open (no phone push yet). Kept for 30 days (D-231).

| Event | Notified (never the person who did it; inactive users skipped) |
|---|---|
| Assigned (also a task created with a technician) | The technician |
| Unassigned / reassigned | The previous technician |
| Submitted | The task's OE |
| OE verified | The OE's manager (OM); all active OMs if the OE has none |
| OM approved | The technician and the task's OE |
| Reopened | The technician; also the task's OE when an OM/SA reopens (the reason is shown) |
| Moved to FT | The task's OE, with the replacement TK id |
| Travel task raised / verified | The technician's OE (else the OMs) / the person who raised it |

A bulk action on one task (CSV bulk fill, *Submit ready*, bulk approve, assigning several) gives **one** notification
per person, e.g. "5 fitments of OM-00012 submitted by Arjun" (same recipient, type, task and actor within 2 minutes
while unread, D-229). The dev simulator's steps notify too, so you can try it without the app.

How it works: notifications are written in the same transaction as the action (from the TaskEvents), with
`pg_notify('champ_notifications')`, which Postgres delivers only on commit. The API process started by `server.ts` runs
one `LISTEN` client and a Socket.IO server on the API port (path `/socket.io`; clients send the access token as
`auth.token`; a bad token gets `connect_error` "UNAUTHORIZED" and the client refreshes and reconnects). Events:
`notification` (`{notification, unreadCount}`) and `notifications:count` (`{unreadCount}`). The web reaches it through
the Vite proxy (`/socket.io`, WebSocket); a production reverse proxy must forward WebSocket upgrades on `/socket.io` too.
The app connects to the API origin directly (websocket transport).

API: `GET /api/notifications?cursor=&limit=` (`{items, unreadCount, nextCursor}`), `GET /api/notifications/unread-count`,
`POST /api/notifications/:id/read` (404 for someone else's) and `POST /api/notifications/read-all`; own notifications
only, any signed-in user.

### Look and feel (CR-03, CR-04)

- **Dashboard**: role-aware stat cards from `GET /api/tasks/summary`. SA/OM see open tasks, awaiting approval,
  re-opened, faulty and completed. OEs see their own tasks, fitments waiting for their verification, open tasks,
  re-opened and faulty. RO sees open and completed tasks. OM and OE also get *Travel to verify* (F08). Each card opens
  the list it counts.
- **Illustrations**: unDraw SVGs (free, no attribution) are bundled in `apps/web/src/assets/illustrations` and
  recoloured by the theme in `index.css`. Empty lists, "no matches", errors and offline states, 403/404 pages,
  invite errors, sign-in and the dashboard use them through `EmptyState` / `ErrorState` / `ListStates`.
- **Theme**: the brand primary is indigo and is defined once in `apps/web/src/index.css` (light and dark tokens). Dark
  mode follows the OS setting.
- **Pages you can't open**: Users, Technicians and Clients show a 403 page. Masters and task pages still redirect to
  the dashboard with a toast (CR-01). Unknown URLs show a 404 page.
- **Dates**: every date and time is picked with the shadcn calendar pickers (`components/date-picker.tsx`; date-times
  in IST, 5-minute steps). List filters use one date-range control.

- **Theme** (CR-09): System / Light / Dark — on the web in the user menu (remembered in the browser), in the app on the Profile tab (remembered on the phone). *System* follows the OS setting.

### Google sign-in

Hidden unless `GOOGLE_CLIENT_ID` is set. When set, only verified Google accounts in `GOOGLE_ALLOWED_DOMAIN`
(default `intellicar.in`) that already have an active Champ account (or a matching invite) can sign in. Add
`http://localhost:3000` as an authorised JavaScript origin of the OAuth client (the dev server is pinned to port 3000
with `strictPort`, CR-05, so it fails instead of moving to another port when 3000 is taken).

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | API (tsx watch) and web (Vite) in parallel |
| `pnpm test` | Unit/integration tests: shared, API (against `champ_test`, recreated each run), web components and the field app (Jest) |
| `pnpm test:e2e` | Playwright E2E (starts its own API on :4100 and web on :5174 against `champ_e2e`, with the dev simulator on and photos in the MinIO bucket `champ-e2e`, so `docker compose up -d` first; geocoding and map tiles are stubbed) |
| `pnpm lint` / `pnpm typecheck` | ESLint / TypeScript across the workspace |
| `pnpm build` | Type-checks the API, builds the web app into `apps/web/dist` and checks that the bundle has no dev simulator |
| `pnpm start` | Runs the API without watch mode |
| `pnpm --filter @champ/mobile start` | Metro for the field app's development build (see *Field app*) |
| `pnpm db:migrate` | Applies pending migrations (`prisma migrate deploy`) |
| `pnpm db:migrate:dev` | Creates a new migration after editing `apps/api/prisma/schema.prisma` |
| `pnpm db:seed` | Creates the Super Admin if missing, upserts the master data and creates the task id counters (idempotent) |
| `pnpm db:seed:demo` | Optional demo data: an OM, an OE, three technicians, two clients with sites and three tasks (idempotent) |
| `pnpm db:reset` | Drops the dev database, re-applies migrations and seeds — **deletes all local data** |

First E2E run on a machine: `pnpm --filter @champ/web exec playwright install chromium`.

## Ports

| Service | Port | Override |
|---|---|---|
| Web (Vite) | 3000 | — (fixed; `strictPort`, CR-05) |
| API | 4000 | `API_PORT` |
| PostgreSQL | 5432 | `POSTGRES_PORT` (compose) + `DATABASE_URL` |
| MinIO API / console | 9000 / 9001 | `MINIO_PORT` / `MINIO_CONSOLE_PORT` (compose) |
| E2E API / web | 4100 / 5174 | — |
| Metro (field app) | 8081 | `--port` |

## Conventions

- **File and folder names are kebab-case** (CR-03 / D-084): `app-shell.tsx`, `task-table.test.tsx`,
  `require-role.ts`, `org.setup.ts`. What a file *exports* keeps its usual casing (`export function AppShell`,
  `type TaskDto`). Middle extensions such as `.test`, `.spec`, `.setup`, `.config` and `.d` are fine.
- Exempt: generated code (`apps/api/src/generated/**`), Prisma migration folders, tool config files whose names
  tools expect (`vite.config.ts`, `prisma.config.ts`, `eslint.config.js`, …) and `README.md`. shadcn/ui components
  in `components/ui` are kebab-case already.
- `pnpm lint` enforces it with `eslint-plugin-check-file` (`check-file/filename-naming-convention` and
  `check-file/folder-naming-convention` in `eslint.config.js`), so a new `MyThing.tsx` fails lint.
  Rename with `git mv` (on macOS, which is case-insensitive, go through a temporary name when only the case changes).

## Project layout

```
apps/api/src
  app.ts              Express app factory (used by tests)
  server.ts           HTTP server entry
  config/env.ts       zod-validated environment
  lib/                prisma, jwt, tokens, password, cookies, google, logger, errors, geocoder/ (Nominatim),
                      counters (transactional OM/OE/TK/TT ids), storage/ (S3 + in-memory photo storage)
  middleware/         authenticate, requireRole, validate, error handler
  modules/            auth, invites, users, health, masters (+ /lookups), technicians, clients, geo,
                      tasks (service, refs, status, filters, events, export, bulk + bulk-rows, summary),
                      workflow (engine, lists, history, router, dev simulator), board (F07 kanban reads),
                      verification (draft save, VERIFY fields, photos, upload checks), dev (simulator sample photos),
                      travel (F08 travel tasks: service, filters, refs, receipts, export, fitment lookup)
apps/api/prisma       schema, migrations, seed (seed-masters.ts: master values; seed-demo.ts: demo users)
apps/web/src
  components/ui       shadcn/ui components (generated)
  components/         app shell, auth provider, shared widgets, site-picker, map/ (react-leaflet), date pickers,
                      empty/error states (illustration, empty-state, list-states), page-header
  assets/illustrations  unDraw SVGs (CR-03)
  features/           auth, invites, users, dashboard, profile, masters (config-driven), technicians, clients, tasks
                      (board/: the F07 kanban), travel (F08), errors (404/403/error boundary)
  lib/                API client (in-memory access token, single-flight refresh), auth context, permissions
packages/shared/src   roles.ts, masters.ts (kinds, permission helpers), clients.ts, tasks.ts (ids, statuses,
                      permissions, IST helpers, CSV columns), workflow.ts (state machine, actors, edit locks),
                      verification.ts (required fields, verification/photo locks, photo kinds),
                      board.ts (board columns, allowed moves and refusals, board roles),
                      travel.ts (F08 travel rules: raise, verify, edit, transitions, scope),
                      schemas.ts, dto.ts
```
