# F10 — Technical Spec

Implements `intent.md` (approved 2026-10-12). Binding decisions: D-012, D-015, D-029, D-077, D-078, D-127, D-133 and D-154–D-158, plus everything from F01–F09. Reuse, don't duplicate:
- the workflow engine and `POST /fitments/:fid/transitions` (START, CLOSE_NOT_DONE and MARK_FAULTY already exist with their payloads and the FT replacement)
- the geocoder lib pattern (`apps/api/src/lib/geocoder`: interface, throttle, LRU, an unreachable URL in tests/E2E) for the new router client
- the F09 `/mobile/*` router, `mobileDateQuerySchema`, the session/api client and theme in `apps/mobile`, and the MapLibre map component

Two parallel agents (D-127):
- **Backend** owns §1–§4 and §6–§7: `packages/shared`, `apps/api`, `apps/web`.
- **Mobile** owns §5: `apps/mobile`.

## 1. Data model (additive migration)

```prisma
model DayRoute {
  id             String   @id @default(cuid())
  technicianId   String                    // User (OT or OE)
  date           DateTime @db.Date         // IST day
  originLat      Float
  originLng      Float
  originSource   RouteOrigin               // GPS | HOME
  fitmentIds     String[]                  // OPEN stops in visiting order at compute time
  legs           Json                      // [{ fitmentId, distanceM, durationS | null }]
  geometry       Json?                     // GeoJSON LineString (OSRM) or null (fallback)
  engine         RouteEngine               // OSRM | STRAIGHT_LINE
  computedAt     DateTime @default(now())
  @@unique([technicianId, date])
}
enum RouteOrigin { GPS HOME }
enum RouteEngine { OSRM STRAIGHT_LINE }
```

## 2. Shared (`packages/shared/src/route.ts`, exported). Backend commits it FIRST, then reports it.

```ts
export const OPEN_ROUTE_STATUSES = ['ASSIGNED', 'REOPENED', 'IN_PROGRESS'] as const;          // stops still to do
export const routeQuerySchema = mobileDateQuerySchema.extend({                                 // GET /mobile/route
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
}); // lat and lng both or neither (refine)
export const recalculateRouteSchema = z.object({ date: isoDay /* window refine */, lat: z.number()…, lng: z.number()… }); // GPS required

export interface RouteStopDto {
  order: number;                 // 1..n across the whole day (done stops first, then open in route order)
  fitment: MyFitmentDto;         // F09 DTO + see below
  done: boolean;                 // status not in OPEN_ROUTE_STATUSES
  isNext: boolean;               // the one stop that may be started (D-156)
  blockedBy: string | null;      // TK id of the stop that must go first, for open non-next stops
  legFromPrevious: { distanceM: number; durationS: number | null } | null; // open stops only
}
export interface DayRouteDto {
  date: string;
  origin: { lat: number; lng: number; source: 'GPS' | 'HOME' } | null;  // null when there are no open stops
  engine: 'OSRM' | 'STRAIGHT_LINE' | null;
  totalDistanceM: number;        // sum of the open legs
  geometry: GeoJSON.LineString | null;
  stops: RouteStopDto[];
  computedAt: string | null;
}
/** Which open stop may start: an IN_PROGRESS one if any, else the first open stop in route order. */
export function nextStopId(openOrdered: { id: string; status: FitmentStatus }[]): string | null;
```

- `MyFitmentDto` gains: `taskId`, `oe: { name, phone } | null`, `assetType`, `installationType`, `availableActions: FitmentAction[]` (the caller's, from `availableActions`). `site.lat`/`lng` are always set for sites.
- New error code `ROUTE_ORDER` (409, message "Finish or close TK-xxxxx first").
- `canPerform` (D-158): the technician steps accept the assigned user when their role is **OT or OE** (`isAssignedTechnician` checks `technicianId === actor.id` and role in `MOBILE_ROLES`). Update the comment and the tests. An OE assigned to a fitment of their own task may also verify it (no other OE exists for that task); the history shows both steps.
- Shared tests:
  - `nextStopId` cases
  - query schema: both coordinates or neither, and the date window
  - `canPerform` for an assigned OE, including that an unassigned OE is refused and an assigned OE of another task is allowed

## 3. Rules
- **Route stops:** the caller's non-deleted fitments whose task `fitmentAt` falls on the IST day (same set as F09 `/mobile/fitments`).
  - **Open** = `OPEN_ROUTE_STATUSES`; **done** = everything else.
- **Reuse or recompute (D-155):** GET reuses the stored `DayRoute` when its `fitmentIds` set equals today's open set (the order of the remaining ones is kept, and the legs too). Otherwise it recomputes:
  - **Origin:** query `lat`/`lng` if given (`GPS`), else the user's home location (`HOME`). With neither, the order is nearest-neighbour from the first open stop by `fitmentAt`, with `origin = null` and engine `STRAIGHT_LINE`.
  - `POST /mobile/route/recalculate` always recomputes from the GPS position given.
  - When some stops are done and others were added, only the **open** stops are re-routed.
- **Order engine:**
  - **OSRM** `/trip/v1/driving/{origin;stops}?source=first&roundtrip=false&geometries=geojson&overview=full`. `waypoints[i].waypoint_index` gives the order; `trips[0].legs` gives distance and duration.
  - **Fallback** on error, timeout (5 s), `NoTrips`, more than 99 stops, or `OSRM_URL` unset in tests: nearest-neighbour by haversine from the origin, straight legs, `durationS: null`, `geometry: null`, engine `STRAIGHT_LINE`.
  - With 0 open stops: no OSRM call, and nothing stored.
- **Done stops** come first, ordered by their finish time (`submittedAt`/`closedAt`/`faultyAt`, else `updatedAt`), then the open stops in route order. `isNext` is per `nextStopId` (D-156).
- **Strict order on START (D-156):** the engine refuses START with 409 `ROUTE_ORDER` when another open fitment of the same technician on the same IST day comes before it in the **stored** route, or is IN_PROGRESS. If no route is stored for that day, any open fitment may start, so the web dev simulator keeps working.
  - Check it in the START path for technician actors only, inside the existing transaction and locks.
  - CLOSE_NOT_DONE and MARK_FAULTY are **not** order-restricted, so a technician can skip by closing.
- **Assignment (D-158):** `POST /tasks/:id/assign` accepts a `technicianId` of an **active OT**, or of an **active OE** when:
  - the caller is SA/OM (any OE), or
  - the caller is the task's OE assigning to themselves.
  - Anything else gets 400 `VALIDATION_ERROR` with a clear message. The options for the assign dialog include those OEs, labelled "(OE)".

## 4. API (prefix `/api`, `/mobile` router: OT and OE)

| Method | Path | Notes |
|---|---|---|
| GET | `/mobile/route?date=&lat=&lng=` | `DayRouteDto` per §3; stores or updates `DayRoute` when it recomputes |
| POST | `/mobile/route/recalculate` | Body `recalculateRouteSchema`; recomputes from GPS; `DayRouteDto` |
| GET | `/mobile/fitments/:fid` | One own fitment as `MyFitmentDto` (404 if not the caller's) |
| POST | `/fitments/:fid/transitions` | Existing. Now also allows an assigned OE (D-158) and enforces `ROUTE_ORDER` on START |

- Router client: `apps/api/src/lib/router/` mirroring the geocoder: an interface, an OSRM implementation with throttle (1 req/s) and a 5 s timeout, and an in-memory stub for tests. Add `OSRM_URL` (default `https://router.project-osrm.org`) to env, `.env.example` and the E2E webServer env (`http://127.0.0.1:9`, forcing the fallback).
- Close reasons come from the existing `GET /lookups`; no new endpoint.

## 5. Mobile (`apps/mobile`) — Mobile agent
**Navigation:** the **Tasks** tab becomes **Route**. New stack screens: `/fitment/[id]` (detail) and `/fitment/[id]/continue` (F10B placeholder).

**Route tab** (selected date from the header):
- On open and on pull-to-refresh: try a GPS fix (balanced accuracy, 10 s timeout; on denial or timeout continue without one), then `GET /mobile/route?date&lat&lng`.
- **Map** (top ~45%):
  - the route line: `geometry`, else straight segments between the stops
  - numbered markers: done ones grey with a tick; the next one in the primary colour
  - the origin marker ("You" for GPS, a house for HOME)
  - fit the bounds to all stops
- **Notice bar:**
  - "Starting from your home location" when the origin is HOME
  - "Approximate order (routing unavailable)" for STRAIGHT_LINE
- **Timeline list:** the number, TK id, status badge, customer, site name, IST time, and for open stops "x.x km · y min from previous". The next stop is highlighted with a *Start* shortcut; blocked stops show "After TK-…". Tapping a row opens the detail.
- ***Recalculate route*** button: needs GPS, else explains why; POST, then refresh.
- Empty state (illustration) for no fitments that day.

**Fitment detail `/fitment/[id]`:**
- **Content:** a small map with the site pin; customer, site address, vehicle reg no./chassis/asset no., activity, asset type, installation type, fitment time (IST), status, and the OE's name and phone (`tel:`).
- **Directions:** iOS `http://maps.apple.com/?daddr=lat,lng`; Android `google.navigation:q=lat,lng`, falling back to `geo:lat,lng?q=lat,lng(label)`.
- **Actions** come from `availableActions` and `isNext`:
  - **Start** (only the next stop): request permission, then a fresh fix (high accuracy, 15 s timeout). Denied or timed out → a dialog explaining that location is required, with an *Open settings* link. Then `START {lat,lng}` → success → the **Continue or Close** sheet.
  - The **Continue or Close** sheet (also shown when opening an In-progress fitment):
    - *Yes, continue* → `/fitment/[id]/continue`, a placeholder saying the form arrives with the next update, and *Back to route*.
    - *No, close* → the close dialog.
  - **Close** (Assigned, Reopened or In progress): a reason select from `/lookups` close reasons and comments (required), then `CLOSE_NOT_DONE`.
  - **Mark faulty:** reason (required, ≤ 500), then `MARK_FAULTY`, then a toast saying "Moved to FT — your OE will arrange a replacement".
  - A 409 `ROUTE_ORDER` or another server message is shown verbatim.
  - After any action, invalidate the route, home and fitment queries.
- Past dates (D-029) work exactly the same.

**Tests (Jest + RNTL):**
- route screen: stops in order, the notice for HOME and STRAIGHT_LINE, the next highlighted, a blocked label, empty state, and recalculate needing GPS
- detail: fields, Directions URL per platform, the Start flow (denied location → no request; success → START body with lat/lng → sheet), the close dialog validation and body, mark faulty, server 409 shown
- continue placeholder

Gates as in F09: test, typecheck, lint, expo-doctor and `expo export`. **No native builds.** No new native module is expected; if one is truly needed, report it instead of adding it.

## 6. Web (Backend agent)
- Assign dialog: the options include eligible OEs labelled "(OE)" per §3. The rest is unchanged.
- An E2E step: an OE assigns a fitment of their task to themselves, and an OM assigns one to an OE.
- Fitments with an OE assignee show the OE's name wherever the technician name shows (it's the same field).
- The dev simulator keeps working for OT-assigned fitments. Allow it to act as an OE assignee too.

## 7. Tests (Backend)
API (Vitest + Supertest) with the in-memory router stub. Cover:
- **Route basics:** OSRM order and legs mapped (stub); fallback order and `null` durations; origin GPS vs HOME vs none; done stops first with their finish order.
- **Reuse and recompute:** reuse when the open set is unchanged; recompute when a fitment is added or closed; recalculate requires GPS; IST day boundaries.
- **Access:** only the caller's fitments; 403 for SA/OM/RO; dates outside the window → 400.
- **START order:**
  - `ROUTE_ORDER` 409 when not next or when another is IN_PROGRESS
  - allowed without a stored route
  - CLOSE_NOT_DONE and MARK_FAULTY not order-restricted
  - concurrency is unchanged
- **OE assignee:**
  - an OE assigning to themselves on their own task is allowed; on another OE's task it's refused
  - SA/OM assign to any active OE; an inactive OE or an RO assignee is refused
  - an assigned OE can START/CLOSE/MARK_FAULTY, and an unassigned OE can't
- **`GET /mobile/fitments/:fid`:** own fitment 200, another's 404.

## 8. Definition of done
- **Backend:** migration applied to the dev DB; `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e` once at the end (ignore failures that are only in `apps/mobile`, and say so).
- **Mobile:** its gates per §5.
- **Both:** report wall time, minutes spent debugging, proposed decisions (Backend D-159 onward; Mobile M-1…), and README notes. Claude writes the README, test report and decision log, then does the native builds and a device smoke test.
