# F03 — Technical Spec

Implements `intent.md` (approved 2026-10-11). Binding decisions: D-020, D-052, D-053, D-054, plus everything from F01/F02. Follow the existing structure and conventions (module layout, error helpers, shared zod schemas and permission helpers, MasterTable-style patterns, combobox, responsive table→cards, one-time patterns, test setup).

## 1. Data model (Prisma)

```prisma
model Client {
  id               String   @id @default(cuid())
  name             String
  nameKey          String   @unique         // lower(trim(name))
  code             String?  @unique         // uppercased, trimmed; [A-Z0-9-]{2,12}
  contactName      String
  contactPhone     String
  contactEmail     String?
  billingEmail     String?
  notes            String?
  active           Boolean  @default(true)
  createdById      String
  createdBy        User     @relation(...)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  sites            ClientSite[]
}

model ClientSite {
  id           String   @id @default(cuid())
  clientId     String
  client       Client   @relation(fields: [clientId], references: [id])
  name         String
  nameKey      String
  address      String
  lat          Float     // -90..90
  lng          Float     // -180..180
  locationId   String    // Location (F02), must be active when set or changed
  location     Location  @relation(...)
  contactName  String?
  contactPhone String?
  active       Boolean  @default(true)
  createdAt/updatedAt
  @@unique([clientId, nameKey])
  @@index([locationId])
}
```

Rules:
- A client must always have **at least one active site**. Creating a client requires `sites: [≥1]`. Deactivating the last active site returns 409 `LAST_ACTIVE_SITE`.
- Deactivating a client doesn't change its sites, but `/lookups` and pickers exclude inactive clients and their sites.
- Phone numbers use the same phone validation as F01/F02. Reuse the shared schema; don't create a new one.

## 2. Geocoding (D-054)
- Define a `Geocoder` interface in `apps/api/src/lib/geocoder/` with `search(q, opts) → GeoResult[]` and `reverse(lat, lng) → GeoResult | null`. `GeoResult` is `{ displayName, lat, lng, city?, state?, postcode? }`.
- `NominatimGeocoder` is the default implementation. Base URL comes from env `NOMINATIM_URL` (default `https://nominatim.openstreetmap.org`).
  - Send `User-Agent: Champ/0.1 (${GEOCODER_CONTACT_EMAIL})`, with env default `admin@intellicar.in`.
  - Use `countrycodes=in`, `addressdetails=1`, `limit=5` and `accept-language=en`.
  - A serial queue keeps calls ≥1 s apart. An LRU cache (~500 entries, 24 h TTL) keys search on normalised `q` and reverse on lat/lng rounded to 5 decimals.
  - Upstream errors or timeouts (5 s) become 503 `GEOCODER_UNAVAILABLE`.
- Tests inject a fake geocoder. **No test may call the real Nominatim.**
- **City suggestion:** after a reverse or search result, match `city` (falling back to town, village or county) and `state` against active Locations, case-insensitive on cityKey and state name. Return `suggestedLocationId` when there's a match.

## 3. API (prefix `/api`)

Permission helper in shared: `canEditClients(user)`, true for SA and OM. Read access: SA, OM, OE and RO (OT gets 403).

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/geo/search?q=` | SA, OM | `q` has at least 3 characters. Returns `{ items: GeoResult & { suggestedLocationId? } }` |
| GET | `/geo/reverse?lat=&lng=` | SA, OM | Returns `{ item: … \| null }` |
| GET | `/clients` | read | `q` (name, code, contact), `active`, `page`, `pageSize`. Items include `siteCount` and `activeSiteCount` |
| GET | `/clients/:id` | read | client plus all sites (with location city/state) |
| POST | `/clients` | canEditClients | `{ name, code?, contactName, contactPhone, contactEmail?, billingEmail?, notes?, sites: [SiteInput, ...] }`, created in one transaction |
| PATCH | `/clients/:id` | canEditClients | client fields plus `active` |
| POST | `/clients/:id/sites` | canEditClients | SiteInput |
| PATCH | `/clients/:id/sites/:siteId` | canEditClients | partial SiteInput plus `active` |

`SiteInput` is `{ name, address, lat, lng, locationId, contactName?, contactPhone? }`.

Errors:
- 409 `DUPLICATE` for a client name or code, or a site name already used within the client.
- 400 `INVALID_REFERENCE` or `INACTIVE_REFERENCE` for the location (reuse F02 helpers).
- 409 `LAST_ACTIVE_SITE`.

Also extend `/lookups` with `clients: [{ id, name, code, sites: [{ id, name, locationId, lat, lng }] }]`, active clients and active sites only. F04 will consume this. The web lookups cache must be invalidated on client and site edits.

## 4. Web
- Add **Clients** to the sidebar for SA, OM, OE and RO.
- **`/clients` list:** table on desktop, cards on mobile. Columns: name, code, contact, sites (active/total), status. Search and an active filter. An "Add client" button for editors.
- **`/clients/new` and `/clients/:id/edit`** are full pages, not dialogs, because the map needs room.
  - Section 1: the client fields.
  - Section 2: sites. Each is a collapsible card with an "Add site" button.
  - Creating requires at least one site.
- **`/clients/:id` detail:** info card plus a map with a marker for every active site (inactive ones in grey), fitted to the markers. A sites list sits beside the map, or under it on mobile.
  - Editors get row actions: edit a site, add a site, activate or deactivate a site, and activate or deactivate the client.
  - Viewers see no edit actions.
- **`<SitePicker>` component**, reusable later (F04, F09). Built with react-leaflet and OSM tiles (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`) with attribution.
  - Address search box with debounced (≥500 ms) results from `/geo/search`. Picking a result moves the map, sets the pin and fills address, lat and lng, and sets the city to the suggested location.
  - Clicking the map or dragging the marker sets the pin and calls `/geo/reverse` (debounced). The returned address fills the address field only if the user hasn't edited it by hand, and the city is suggested the same way.
  - Read-only lat/lng display. A "Use my location" button (browser geolocation) is optional and should be included if trivial.
  - On geocoder errors, show an inline message ("Address lookup is unavailable; place the pin and type the address"). Manual entry still works.
  - Default view is India (lat 22.5, lng 79, zoom 5).
  - Must work with touch at 360 px, with a map height of at least 280 px on mobile.
- Leaflet marker icons break under Vite. Fix the default icon URLs, or use a custom divIcon.

## 5. Tests
- **API:**
  - client CRUD with nested sites, in one transaction
  - duplicate name and code (case-insensitive name, code normalised to uppercase)
  - site name duplicates within a client
  - last-active-site rule
  - inactive location rejected
  - permissions: SA and OM edit; OE and RO read only; OT gets 403 on reads
  - `/lookups` includes only active clients and sites
  - `/geo/*` with a fake geocoder: results, suggested location matching, 503 mapping, cache hits, and throttle spacing (fake timers)
- **Shared:** schemas (lat/lng bounds, code format) and `canEditClients`.
- **Web:** SitePicker (search result sets pin and fields; manual address not overwritten by reverse; error message shown) with the API mocked and Leaflet mocked or jsdom-safe. Also client form validation (at least one site required).
- **E2E** (desktop and 360 px), with geocoding stubbed using Playwright route interception of `/api/geo/*`. Never hit real Nominatim in tests.
  - An OM creates a client with a site via search plus pin, and sees it on the detail map.
  - Adds a second site, then tries to deactivate the last active site and is blocked.
  - An OE sees the client with no edit actions.

## 6. Definition of done
- Migration applies on top of F02 data.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm test:e2e` all pass.
- Manual smoke test against real Nominatim: at most a couple of calls, through `/api/geo/search` with curl.
- Optional demo seed: add 2 sample clients with sites, with hard-coded coordinates and no geocoding, to `db:seed:demo`.
- README updated (new env vars).
- `test-report.md` includes a UAT checklist covering all 9 acceptance criteria.
