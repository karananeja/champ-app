# F03 — Client Onboarding with Map: Intent

| | |
|---|---|
| Status | **Awaiting user sign-off** |
| Requirements | SRS §3, §6.3 · source doc: "When the client is onboarded, we can ask for their address on the map to capture the exact location" · Decision D-020 (public OSM services) |
| Depends on | F02 (complete) |

## Why
Every task starts with a customer. The route planner in the mobile app (F10) needs real coordinates for where each fitment happens. Capturing the exact location on a map when a client is onboarded gives us those coordinates.

## What will be built

**1. Clients (web, new "Clients" page)**
- The list shows name, code, primary contact, number of sites and status. It has search, an active/inactive filter, and turns into cards on phones.
- Add/edit a client:
  - **Name** (required, unique) and **short code** (optional, unique, e.g. `ZOOM`, used in reports).
  - **Primary contact:** name, phone, email (optional).
  - **Billing email** (optional, for the monthly report) and **notes** (optional).
  - **Status:** active or inactive. As with masters, clients are deactivated, never deleted.
- A client detail page shows its info and a map with all of its sites.

**2. Client sites with a map pin (recommended, see open point 1)**

A client can have one or more **sites** (head office, depot, yard). For each site:
- **Site name**, e.g. "Bengaluru depot".
- **Address on the map:** type an address to search (OpenStreetMap / Nominatim), then drag the pin to the exact spot. Or drop the pin first and the address fills in automatically. Latitude and longitude are saved.
- **City:** from the Locations master (F02). It's suggested automatically from the pin, and you can change it.
- Optional **site contact** name and phone.

The first site is required when adding a client, so every client has at least one exact location.

**3. Map service (API)**
- Address search and reverse lookup go through our API, not straight from the browser. This lets us respect OpenStreetMap's usage policy (identifying header, at most 1 request a second) and cache results.
- The map uses free OSM tiles (D-020).

## Who can do what

| | SA | OM | OE | RO | OT |
|---|---|---|---|---|---|
| View clients and sites | ✅ | ✅ | ✅ | ✅ | — |
| Add/edit/deactivate clients and sites | ✅ | ✅ | — | — | — |

## Out of scope for F03
- Using clients and sites in the task form (F04).
- Billing data on clients beyond the billing email (F15).
- Bulk import of clients.

## Acceptance criteria (UAT)
1. An OM adds a client with a primary contact and one site. Searching an address moves the pin, dragging the pin updates the address, and the saved site reopens at the same spot.
2. Dropping a pin with no address search fills in the address and suggests the city.
3. A client can have several sites, and all of them show on the client's detail map.
4. A duplicate client name or code is rejected with a clear message.
5. A client can't be saved without at least one active site.
6. A deactivated client or site is greyed out and won't be offered in task forms (verified once F04 exists; for now, through the active filter).
7. OE and RO users see clients and maps with no edit actions. OT users can't open the page.
8. If the map lookup service is unreachable, the user can still place the pin by hand and type the address, and sees a clear message.
9. Works at 360 px, with the map usable on touch. Automated tests pass.

## Open points for this feature
1. **Sites:** I recommend multiple sites per client, because fitments for one customer often happen at different depots or cities. Later, the task form would pick the client and then one of its sites, which gives the route planner exact coordinates. The alternative is a single address per client, with the optional GPS address on each task as the only per-fitment location. Which do you prefer?
2. **Client fields:** are name, code, primary contact, billing email and notes enough? Do you need GSTIN, a billing address or contract details?
