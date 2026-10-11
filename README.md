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
(F03). It skips accounts and clients that already exist.

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

### Google sign-in

Hidden unless `GOOGLE_CLIENT_ID` is set. When set, only verified Google accounts in `GOOGLE_ALLOWED_DOMAIN`
(default `intellicar.in`) that already have an active Champ account (or a matching invite) can sign in. Add
`http://localhost:5173` as an authorised JavaScript origin of the OAuth client.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | API (tsx watch) and web (Vite) in parallel |
| `pnpm test` | Unit/integration tests: shared, API (against `champ_test`, recreated each run) and web components |
| `pnpm test:e2e` | Playwright E2E (starts its own API on :4100 and web on :5174 against `champ_e2e`; geocoding and map tiles are stubbed) |
| `pnpm lint` / `pnpm typecheck` | ESLint / TypeScript across the workspace |
| `pnpm build` | Type-checks the API and builds the web app into `apps/web/dist` |
| `pnpm start` | Runs the API without watch mode |
| `pnpm db:migrate` | Applies pending migrations (`prisma migrate deploy`) |
| `pnpm db:migrate:dev` | Creates a new migration after editing `apps/api/prisma/schema.prisma` |
| `pnpm db:seed` | Creates the Super Admin if missing and upserts the master data (idempotent) |
| `pnpm db:seed:demo` | Optional demo data: an OM, an OE, three technicians and two clients with sites (idempotent) |
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

## Project layout

```
apps/api/src
  app.ts              Express app factory (used by tests)
  server.ts           HTTP server entry
  config/env.ts       zod-validated environment
  lib/                prisma, jwt, tokens, password, cookies, google, logger, errors, geocoder/ (Nominatim)
  middleware/         authenticate, requireRole, validate, error handler
  modules/            auth, invites, users, health, masters (+ /lookups), technicians, clients, geo (router + service)
apps/api/prisma       schema, migrations, seed (seed-masters.ts: master values; seed-demo.ts: demo users)
apps/web/src
  components/ui       shadcn/ui components (generated)
  components/         app shell, auth provider, shared widgets, SitePicker, map/ (react-leaflet)
  features/           auth, invites, users, dashboard, profile, masters (config-driven), technicians, clients
  lib/                API client (in-memory access token, single-flight refresh), auth context, permissions
packages/shared/src   roles.ts, masters.ts (kinds, permission helpers), clients.ts, schemas.ts, dto.ts
```
