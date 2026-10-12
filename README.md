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
pnpm dev                    # API on :4000, web on :5173
```

Open http://localhost:5173 and sign in with the seeded Super Admin:

- Email: `admin@intellicar.in`
- Password: `Admin@1234`

(Change them with `SEED_SUPERADMIN_EMAIL` / `SEED_SUPERADMIN_PASSWORD` in `.env` before seeding.)

The web dev server proxies `/api` to the API, so the refresh cookie is same-origin. Check the API with
`curl http://localhost:5173/api/health`.

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
| `GEOCODER_CONTACT_EMAIL` | `admin@intellicar.in` | Contact sent in the `User-Agent` (`Champ/0.1 (<email>)`), as the OSM usage policy asks |

`pnpm db:seed:demo` also adds two sample clients (*Demo Fleet Rentals* with sites in Bengaluru and Pune, *Demo
Logistics* in New Delhi), with hard-coded coordinates.

### Tasks (F04)

The **Tasks** menu (SA, OM, OE and RO; not OT) holds *Create task*, *Bulk upload* (creators only), *Open tasks*,
*Assigned* (OEs: tasks where they are the operation executive), *Awaiting approval* (SA/OM), *Completed tasks*
(latest completion first) and *All tasks* (every status; CR-04), *Faulty tasks* and *Re-opened* (F05, below) and a
placeholder for *Travel tasks* (F08).

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

### Google sign-in

Hidden unless `GOOGLE_CLIENT_ID` is set. When set, only verified Google accounts in `GOOGLE_ALLOWED_DOMAIN`
(default `intellicar.in`) that already have an active Champ account (or a matching invite) can sign in. Add
`http://localhost:5173` as an authorised JavaScript origin of the OAuth client.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | API (tsx watch) and web (Vite) in parallel |
| `pnpm test` | Unit/integration tests: shared, API (against `champ_test`, recreated each run) and web components |
| `pnpm test:e2e` | Playwright E2E (starts its own API on :4100 and web on :5174 against `champ_e2e`, with the dev simulator on; geocoding and map tiles are stubbed) |
| `pnpm lint` / `pnpm typecheck` | ESLint / TypeScript across the workspace |
| `pnpm build` | Type-checks the API, builds the web app into `apps/web/dist` and checks that the bundle has no dev simulator |
| `pnpm start` | Runs the API without watch mode |
| `pnpm db:migrate` | Applies pending migrations (`prisma migrate deploy`) |
| `pnpm db:migrate:dev` | Creates a new migration after editing `apps/api/prisma/schema.prisma` |
| `pnpm db:seed` | Creates the Super Admin if missing, upserts the master data and creates the task id counters (idempotent) |
| `pnpm db:seed:demo` | Optional demo data: an OM, an OE, three technicians, two clients with sites and three tasks (idempotent) |
| `pnpm db:reset` | Drops the dev database, re-applies migrations and seeds — **deletes all local data** |

First E2E run on a machine: `pnpm --filter @champ/web exec playwright install chromium`.

## Ports

| Service | Port | Override |
|---|---|---|
| Web (Vite) | 5173 | — |
| API | 4000 | `API_PORT` |
| PostgreSQL | 5432 | `POSTGRES_PORT` (compose) + `DATABASE_URL` |
| MinIO API / console | 9000 / 9001 | `MINIO_PORT` / `MINIO_CONSOLE_PORT` (compose) |
| E2E API / web | 4100 / 5174 | — |

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
                      counters (transactional OM/OE/TK ids)
  middleware/         authenticate, requireRole, validate, error handler
  modules/            auth, invites, users, health, masters (+ /lookups), technicians, clients, geo,
                      tasks (service, refs, status, filters, events, export, bulk + bulk-rows),
                      workflow (engine, lists, history, router, dev simulator)
apps/api/prisma       schema, migrations, seed (seed-masters.ts: master values; seed-demo.ts: demo users)
apps/web/src
  components/ui       shadcn/ui components (generated)
  components/         app shell, auth provider, shared widgets, site-picker, map/ (react-leaflet)
  features/           auth, invites, users, dashboard, profile, masters (config-driven), technicians, clients, tasks
  lib/                API client (in-memory access token, single-flight refresh), auth context, permissions
packages/shared/src   roles.ts, masters.ts (kinds, permission helpers), clients.ts, tasks.ts (ids, statuses,
                      permissions, IST helpers, CSV columns), workflow.ts (state machine, actors, edit locks),
                      schemas.ts, dto.ts
```
