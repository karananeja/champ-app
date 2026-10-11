# F03 — Conversation Log

## 2026-10-11
- F02 accepted and merged to main.
- Claude drafted `intent.md` and sent it to the user for sign-off. Open points: multiple sites per client, and extra client fields.
- User replied "approved". The open points are accepted as proposed (D-052, D-053). Created branch `feature/F03-clients`.

## 2026-10-11 — Implementation (impl agent)
- Implemented the spec on `feature/F03-clients`: migration `20261011165500_clients` (additive: `Client`, `ClientSite`), geocoder abstraction in `apps/api/src/lib/geocoder/` (Nominatim, serial 1 s throttle, LRU 500/24 h, 5 s timeout), `/geo/search` and `/geo/reverse` with city suggestion, `/clients` CRUD with nested sites, `clients` in `/lookups`, shared schemas/DTOs/permissions, and the demo seed's two sample clients.
- Web: Clients in the sidebar (SA, OM, OE, RO); list (table/cards), full-page create/edit with collapsible site cards, detail page with a sites map; reusable `<SitePicker>` (react-leaflet, OSM tiles, debounced search, tap/drag pin with reverse lookup, inline "lookup unavailable" message, "Use my location").
- Tests: shared 93, API 192, web 34, E2E 16 passed / 1 skipped (by design). No test reaches Nominatim or the OSM tile server.
- Verification: dev DB migrated with F01/F02 data kept (2 users, 80 lookup values, 8 locations, 1 invite unchanged); `pnpm dev` health OK; `GET /api/clients` as SA → 200; two real Nominatim calls through the API (one search, one reverse), both 200. Servers stopped.
- Decisions added: D-055 (API details), D-056 (geocoder details), D-057 (web), D-058 (test isolation).
