# F03 — Test Report

| | |
|---|---|
| Date | 2026-10-11 |
| Branch | `feature/F03-clients` |
| Environment | macOS, Node 24.14, pnpm 10.33, Docker (postgres:16-alpine, pgsty/minio), Chromium (Playwright 1.64) |
| Result | **All gates pass**: typecheck, lint, build, 319 unit/integration tests, 16 E2E tests (1 skipped by design) |

## 1. Definition of done

| Step | Command | Result |
|---|---|---|
| Migrate (dev DB with F01 + F02 data) | `pnpm db:migrate` | `20261011165500_clients` applied on top of `init` and `master_data`. Additive only (two new tables). Row counts before/after: User 2/2, LookupItem 80/80, Location 8/8, Invite 1/1; Client 0 |
| Run | `pnpm dev` | API on :4000, web on :5173 |
| Health | `curl localhost:4000/api/health`, `curl localhost:5173/api/health` | `{"ok":true,"db":"up"}` [200] both |
| Clients | SA login, then `GET /api/clients` with the bearer token | 200 `{"items":[],"total":0,"page":1,"pageSize":20}`; `GET /api/lookups` has `clients: []` |
| Real Nominatim (2 calls in total) | `GET /api/geo/search?q=MG Road Bengaluru`, then `GET /api/geo/reverse?lat=18.5912&lng=73.7389` | Both 200. Search: 5 hits on Mahatma Gandhi Road, Bengaluru, each with `suggestedLocationId` = the seeded Bengaluru location. Reverse: "Hinjawadi Phase 1 road, … Pune District, Maharashtra, 411057", `city: "Mhalunge"`, so no suggestion (see §3) |
| Web | `GET localhost:5173/clients` | 200 |

The servers were stopped afterwards; no processes were left running. `pnpm db:seed:demo` was not run on the dev
database, to leave it as it is (UAT step 0 below covers it).

## 2. Quality gates

| Command | Result |
|---|---|
| `pnpm typecheck` | exit 0 (shared, api, web) |
| `pnpm lint` | exit 0: 0 errors, 0 warnings |
| `pnpm build` | exit 0 |
| `pnpm test` | exit 0: **319 passed / 0 failed** (shared 93, api 192, web 34) |
| `pnpm test:e2e` | exit 0: **16 passed / 0 failed / 1 skipped** |

### 2.1 Shared (`packages/shared`): 93 passed (F02: 61, new: 32)

| File | Tests | Covers |
|---|---|---|
| `test/clients.test.ts` (new) | 32 | `canViewClients` / `canEditClients` for every role; **client code** trimmed and uppercased, `[A-Z0-9-]{2,12}` (accepts/rejects); **site lat/lng bounds** (±90, ±180 inclusive, just-outside rejected); friendly messages (site name, address, "Place the pin on the map", "Choose a city"); shared phone rule for the site contact; **at least one site** (empty and missing); client field errors (name, contact, phone, emails, code); blanks become `null`; update schemas (≥1 field, `null` clears, lat/lng together); list query defaults and `active`; geo search ≥3 chars; geo reverse coercion and bounds |
| other files | 61 | unchanged |

### 2.2 API (`apps/api`, against `champ_test`): 192 passed (F02: 153, new: 39)

| File | Tests | Covers |
|---|---|---|
| `test/clients.test.ts` (new) | 22 | **create with nested sites** and read-back (location city/state, createdBy, counts); **one transaction** (a bad second site leaves no client or site); ≥1 site; body validation; PATCH fields, clearing optional ones, deactivate/reactivate (sites untouched); list search by name/code/contact, active filter, `siteCount`/`activeSiteCount`, pagination; 404s, including a site of another client. **Duplicates**: name case-insensitive, code normalised to uppercase (409 with field errors), rename/code change vs other clients only, several clients without a code, **site names within a client** (in the create body, on add, on rename; allowed across clients). **Last-active-site rule** (409 `LAST_ACTIVE_SITE`, then allowed once a second site exists, re-saving an inactive site is fine). **Inactive/unknown location** rejected on create, add and change (`INACTIVE_REFERENCE` / `INVALID_REFERENCE` on `sites.N.locationId`), while a site whose location was deactivated later stays editable. **Permissions**: SA and OM read and write; OE and RO read only (403 before validation); OT 403 on reads and writes; 401 without a token. **`/lookups`** includes only active clients and their active sites |
| `test/geo.test.ts` (new) | 17 | With a **fake geocoder**: search results with `suggestedLocationId`; matching case-insensitive on city and state, ignoring inactive locations, other states, ambiguous city-only and city-less hits; `q` ≥ 3 chars (no provider call); **503 mapping** for provider errors (search and reverse); reverse result and `null`; lat/lng validation; SA/OM only (OE, RO, OT 403; 401). `NominatimGeocoder` with a **fake fetch**: `User-Agent: Champ/0.1 (<email>)`, `countrycodes=in`, `addressdetails=1`, `limit=5`, `accept-language=en`; result mapping and city fallback (town/village/county); "Unable to geocode" → null; **cache hits** (normalised query; lat/lng rounded to 5 decimals); TTL expiry; errors not cached; LRU eviction; HTTP, network and payload errors; **5 s timeout**; **throttle spacing with fake timers** (starts at 0, 1000, 2000 ms; cache hits skip the queue; no wait after a quiet period); a failed request doesn't block the queue |
| other files | 153 | unchanged (the `/lookups` F02 test still passes with the new `clients` key) |

### 2.3 Web components (`apps/web`): 34 passed (F02: 24, new: 10)

Leaflet is replaced in jsdom by `src/test/FakePinMap.tsx` (`vi.mock('@/components/map/PinMap')`), and the API is
mocked with `mockApi`.

| File | Tests | Covers |
|---|---|---|
| `components/SitePicker.test.tsx` (new) | 5 | **Search result sets pin, address, coordinates and suggested city**; the search is debounced (one request for "MG Road"); picking doesn't trigger a reverse lookup. **Tapping the map** sets the pin, the reverse lookup fills the address and suggests the city. **An address typed by hand is not overwritten** by the reverse lookup. **Geocoder unavailable** (503 on search and reverse): inline message, and pin + address still work by hand. A failed reverse lookup alone also shows the message |
| `features/clients/ClientForm.test.tsx` (new) | 5 | Required client and site fields without an API call; **at least one site required** ("Add at least one site" after removing the only site card; adding one back); full create with a pin from the map and the suggested city, checking the POST body and the redirect; server duplicate shown on the name field; edit page with `?add=site` POSTs only the new site and leaves unchanged client fields and sites alone |
| other files | 24 | unchanged |

### 2.4 E2E (`apps/web/e2e`, Playwright, Chromium): 16 passed, 1 skipped

`/api/geo/*` and `tile.openstreetmap.org` are stubbed with `page.route`, and the E2E API runs with an unreachable
`NOMINATIM_URL`, so nothing reaches OpenStreetMap. The `setup` project now also creates one client (through the
API, as SA) for the read-only check.

| Test | desktop (1280×720) | mobile-360 (360×740, touch) |
|---|---|---|
| `clients.spec.ts`: **OM creates a client**: search "MG Road" → pin, address and city (Bengaluru) set; **drag the pin** → new coordinates and the reverse-looked-up address; create → **detail map shows the marker**; **Edit site reopens at the same coordinates**; **adds a second site** via search (city Pune suggested) → 2 markers, "Sites (2/2 active)"; deactivates one (greyed out, `data-active=false`); **deactivating the last active site is blocked** with "A client needs at least one active site…"; list shows "1/2"; no horizontal overflow | ✓ | ✓ |
| `clients.spec.ts`: **OE sees the client and map with no edit actions** (no Add client, Edit client, Add site, switches or activate button); `/clients/:id/edit` redirects home | ✓ | ✓ |
| F01/F02 specs (invite flow, read-only, masters ×2, technicians ×2) | ✓ | ✓ (read-only skipped by design) |

## 3. Known limitations

- **City suggestion depends on Nominatim's naming.** A suggestion is made only when the hit's city (or town,
  village, county) and state match exactly one active Location. Suburbs and villages around a city (e.g. a
  reverse lookup in Hinjawadi returns `Mhalunge`) and alternate spellings (Bangalore/Bengaluru, Gurgaon/Gurugram)
  don't match, so the City select is left as it was and the user picks it. Adding more Locations, or matching on
  the district later, would improve this.
- **Public Nominatim is slow by design**: the API serialises requests at 1 per second for all users together, and
  there is no queue cap. That's fine for a handful of office users. Production should self-host Nominatim
  (`NOMINATIM_URL`, D-054).
- **The cache is in memory**: it is per API process and empties on restart.
- **Map tiles come straight from `tile.openstreetmap.org`** (D-020), which is fine for light office use under the
  OSM tile policy, but not for heavy production traffic.
- **Saving the edit page sends several requests** (client fields, then each new or changed site). If one fails,
  earlier ones are already saved; the page shows the error on the failing site, and saving again continues
  without duplicating sites (D-057).
- **Site activation is on the detail page only**, not on the edit page.
- "Use my location" needs a secure context (https or localhost) and the browser's permission.
- Clients don't appear in task forms yet (F04); AC 6 is verified through the active filter and `/api/lookups`.

## 4. UAT checklist (manual verification)

Setup: follow the README quick start, including `pnpm db:migrate`. Optionally run `pnpm db:seed:demo` for the
demo OM/OE (`demo.om@intellicar.in`, `demo.oe@intellicar.in`, password `Demo@1234`) and two sample clients. Open
http://localhost:5173. SA: `admin@intellicar.in` / `Admin@1234`. Use a private window per extra user. The machine
needs internet access for the map tiles and address search.

| # | Acceptance criterion | How to verify | Automated coverage |
|---|---|---|---|
| 1 | An OM adds a client with a primary contact and one site. Searching an address moves the pin, dragging the pin updates the address, and the saved site reopens at the same spot | As the OM: **Clients → Add client**. Fill name, contact name and phone. In the site card, enter a site name and type an address in **Search address** (e.g. "MG Road Bengaluru"); wait a moment, pick a result: the map jumps there, the pin, address and coordinates are set, and **City** shows Bengaluru, Karnataka. Drag the pin a little: the coordinates change and, after a second, the address updates. Note the coordinates, click **Create client**. On the detail page, click the site's pencil: the edit page shows the same coordinates and pin | SitePicker.test, ClientForm.test, clients.test (create), E2E clients (OM) |
| 2 | Dropping a pin with no address search fills in the address and suggests the city | On a new site card, don't search: tap/click the map near a seeded city (e.g. central Pune). The pin appears, the address fills in, and City is suggested (when the place's city matches a Location, see §3) | SitePicker.test (tap map), geo.test (suggestion matching), ClientForm.test |
| 3 | A client can have several sites, and all of them show on the client's detail map | On the detail page, **Add site**, place it in another city, **Save changes**. The detail map shows both pins and zooms to fit them; the list says "Sites (2/2 active)". Or open the demo client *Demo Fleet Rentals* (Bengaluru and Pune) | clients.test (nested sites, add site), E2E clients (OM) |
| 4 | A duplicate client name or code is rejected with a clear message | Add another client named like an existing one in different case (e.g. "demo logistics"): *A client named "Demo Logistics" already exists* appears under the name. Use an existing code in lower case (e.g. "dlog"): *Code DLOG is already used by Demo Logistics*. Two sites with the same name in one client are rejected too | clients.test (duplicates), shared clients.test, ClientForm.test (duplicate) |
| 5 | A client can't be saved without at least one active site | On **Add client**, remove the only site card (bin icon) and click **Create client**: "Add at least one site". On a client with one active site, flip its switch → **Deactivate**: the toast says *A client needs at least one active site. Add or activate another site first.* and the site stays active | ClientForm.test, clients.test (last active site), E2E clients (OM) |
| 6 | A deactivated client or site is greyed out and won't be offered in task forms (for now: the active filter) | Deactivate a site (with another active one): it stays in the list greyed out with "Inactive" and a grey pin on the map. Use **Deactivate client** on the detail page: the list row is greyed out; the status filter *Active / Inactive / All* works. `GET /api/lookups` (signed in) lists only active clients and their active sites | clients.test (list filter, /lookups), E2E clients (OM) |
| 7 | OE and RO users see clients and maps with no edit actions. OT users can't open the page | As an OE and an RO: **Clients** is in the sidebar, the list and detail map show, with no Add client, Edit client, Add site, switches or pencils; `/clients/new` sends them home. As an OT: there's no Clients link and `/clients` sends them home (API: 403) | clients.test (permissions), geo.test (403), E2E clients (OE) |
| 8 | If the map lookup service is unreachable, the user can still place the pin by hand and type the address, and sees a clear message | Stop the internet connection (or set `NOMINATIM_URL=http://127.0.0.1:9` in `.env` and restart `pnpm dev`). Search an address: the amber message *Address lookup is unavailable; place the pin and type the address* appears. Tap the map (the pin is placed), type the address, pick the city, and save: it works | SitePicker.test (unavailable), geo.test (503 mapping) |
| 9 | Works at 360 px, with the map usable on touch. Automated tests pass | In devtools pick a 360 px device (touch). Clients list shows cards; Add client, the site picker (map ≥ 280 px tall, pinch/drag to pan, tap to place, drag the pin) and the detail page (map above the site list) fit without horizontal scrolling. Run `pnpm test` (319 passed) and `pnpm test:e2e` (16 passed, 1 skipped) | E2E mobile-360 (touch, overflow checks), §2 |
