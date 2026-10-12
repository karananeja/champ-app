# F12 — Technical Spec

Implements `intent.md` (approved 2026-10-12). Binding decisions: D-014, D-015, D-029, D-073, D-098, D-101, D-127, D-155, D-158, D-177/D-178, D-216–D-220, plus everything from F01–F11. Reuse, don't duplicate:
- the route optimiser (`apps/api/src/lib/router/*`: OSRM with its 1 s throttle and 5 s timeout, straight-line fallback, the in-memory stub for tests) and the IST day helpers in `mobile/route.ts` / `mobile/service.ts` (`istDayOf`, `onIstDay`, `dbDate`, `mobileDateOptions`)
- verification: `oeVerificationQueueWhere`, `verifyFitmentFields`, the VERIFY/REOPEN transitions through `POST /api/fitments/:fid/transitions` (they already accept the OE, inline verification fields and the reopen reason), `GET /api/lookups`
- F10B's `technicianPhotos`, `toFormDto`, `readableForm`; F06's verification DTO (`verification/dto.ts`)
- on mobile: the date chip/selected date, `StateView`, `Dialog`, toast, the F10B summary screen's read-only form and photo viewer

Two parallel agents (D-127):

| Agent | Owns |
|---|---|
| **Backend** | `packages/shared`, `apps/api` (and `apps/web` only if a shared change breaks it): §1–§4, §7 |
| **Mobile** | `apps/mobile`: §5–§6 |

## 1. Shared (`packages/shared/src/mobile-history.ts`, exported). Backend commits it FIRST and reports it.

```ts
export type TimelineStepKind = 'STARTED' | 'SUBMITTED' | 'CLOSED_NOT_DONE' | 'MOVED_TO_FT';
export interface TimelineStep { kind: TimelineStepKind; at: string /* UTC ISO */; label: string /* 'Started', 'Submitted', 'Closed – not done: <reason>', 'Moved to FT' */ }
export interface TimelineEntryDto {
  fitmentId: string; tkId: string; status: FitmentStatus; customer: string; site: { name: string; address: string | null };
  vehicleRegNo: string | null;
  steps: TimelineStep[];               // that day's steps, oldest first
  /** Driving distance from the previous started entry's start position; null for the first started entry and for entries not started. */
  legFromPreviousM: number | null;
  started: boolean;
}
export interface DayHistoryDto {
  date: string;                         // YYYY-MM-DD (IST)
  user: { id: string; name: string; role: Role };
  distanceM: number;                    // D-216
  /** true when the distance is straight-line (routing unavailable). */
  approx: boolean;
  startedCount: number;
  entries: TimelineEntryDto[];          // ordered by first step time
}
export interface ReporteeDayDto {
  user: { id: string; name: string; phone: string | null };
  startedCount: number;
  distanceM: number;
  approx: boolean;
}
export interface ReporteesHistoryResponse { date: string; items: ReporteeDayDto[] }   // by name

export const historyQuerySchema = mobileDateQuerySchema.extend({ userId: z.string().min(1).optional() });

export interface ApproveVisitItemDto {
  fitmentId: string; tkId: string; customer: string; site: { name: string; address: string | null };
  technician: { id: string; name: string } | null; vehicleRegNo: string | null; submittedAt: string | null;
}
export interface ApproveVisitListResponse { date: string; items: ApproveVisitItemDto[] }  // by submittedAt asc
export interface ApproveVisitDetailDto {
  item: ApproveVisitItemDto;
  status: FitmentStatus;
  isVehicle: boolean;
  form: FitmentFormDto;
  photos: FitmentPhotoDto[];            // active technician photos, presigned
  verification: FitmentVerificationDto; // existing F06 DTO (ids of issue observed, action taken, accessories, remarks, final issue)
  startedAt: string | null;
  availableActions: FitmentAction[];    // VERIFY / REOPEN for the caller
}
```

- **Day selection (D-217):** a fitment of the user appears on day *D* (IST) when it has a step on *D* (started, submitted, closed – not done, moved to FT; times from the fitment's `startedAt`, `submittedAt`, `closedAt`, `faultyAt`), and only *D*'s steps are shown. `started` = it was started on *D*; only those count for `startedCount` and the distance. A fitment closed without starting appears but adds nothing.
- **Distance (D-216):** points = start positions (`startLat`/`startLng`) of the fitments started on *D*, ordered by `startedAt`; consecutive points at the same site (same `siteId`) or less than 50 m apart are merged (0 km). 0 or 1 point → 0 m. Otherwise one OSRM **route** request in that fixed order (not a trip). Routing unavailable → haversine sum with `approx: true`. A fitment started without coordinates is skipped.
- **Cache:** `DayDistance` (additive migration) `{ userId, date @db.Date, signature String, distanceM Int, approx Boolean, legs Json, computedAt }`, unique `(userId, date)`. `signature` = hash of the ordered points. The personal/reportee timeline uses the cached value when the signature matches, else computes and stores it (approx results are stored too but retried when older than 10 min).
- **Reportees list** never calls OSRM: it uses a matching cached routed value, else the straight-line value with `approx: true`. Opening a reportee's timeline computes and caches the routed value.

## 2. Router (`apps/api/src/lib/router`)
- Add to `RouteOptimizer`: `route(points: LatLng[]): Promise<{ legs: { distanceM: number; durationS: number | null }[] }>`; legs between consecutive points, fixed order.
- OSRM: `/route/v1/driving/{p1;p2;…}?overview=false` (≤ 100 points, same throttle/timeout/errors). Straight-line and stub implementations too. Update existing tests and stubs that implement the interface.

## 3. Rules
- **History access:** `userId` omitted or = caller → own history (OT, OE). Another `userId` → only an OE whose **direct reportee** it is (D-218: `managerId` = caller, role OT or OE, any status so past days still show), else 403. Dates as `mobileDateQuerySchema` (today and 7 days back).
- **Reportees:** only OE (OT → 403). Active users whose `managerId` = caller and role is OT (or an OE reporting to an OE, if that hierarchy exists — include any technician-type role allowed on mobile).
- **Approve visit (OE only, OT → 403):** list = `oeVerificationQueueWhere(caller)` and the fitment's task `fitmentAt` on *D* (the same filter as the home count, so they always match), ordered by `submittedAt`. Detail: same check (the caller is the task's OE); 404 otherwise. **Verify** and **Reopen** use the existing `POST /api/fitments/:fid/transitions` (VERIFY with the inline verification fields; REOPEN with `reason`), so the rules, history, billable snapshot and reopen attributions are exactly the web's. The mobile router must not duplicate them.

## 4. API (prefix `/api/mobile`, OT/OE)

| Method | Path | Notes |
|---|---|---|
| GET | `/history?date=&userId=` | `DayHistoryDto` |
| GET | `/history/reportees?date=` | `ReporteesHistoryResponse` (OE only) |
| GET | `/approve-visit?date=` | `ApproveVisitListResponse` (OE only) |
| GET | `/approve-visit/:fid` | `ApproveVisitDetailDto` (OE only, own task) |
| POST | `/api/fitments/:fid/transitions` | Existing: VERIFY / REOPEN |
| GET | `/api/lookups` | Existing: issues observed, actions taken, accessories, final issues (with `billable`) |

New code in `apps/api/src/modules/mobile/history.ts` and `mobile/approve-visit.ts`; routes in `mobile/router.ts`. Pass the `RouteOptimizer` already given to `mobileRouter`.

## 5. Mobile (`apps/mobile`, JS only, no new dependencies)

**History tab** (`src/app/(app)/history.tsx` → `src/screens/history-screen.tsx`; tab order Home, Route, History, Profile):
- The shared selected-date chip.
- OE: segmented tabs **Personal** / **Direct reportees**. OT: no tabs.
- **Timeline** (`src/components/day-timeline.tsx`, reused for a reportee): header "42.6 km · 6 fitments" ("≈ 42.6 km (approx.)" when `approx`); entries with TK id, customer, site, reg no., status badge, and steps with IST times; a "↓ 3.2 km" connector from `legFromPreviousM` between started entries. Empty: an illustration and "Nothing done on this day". Pull to refresh. Tap an entry → its summary for Personal (`/fitment/[id]/summary`); for a reportee it is read-only (no navigation, or a read-only summary if the existing screen supports a viewer that isn't the technician — otherwise no navigation).
- **Direct reportees:** list with name, "6 fitments · 42.6 km"; tap → `/history/[userId]` showing their timeline with their name in the header.

**Approve visit** (Home's *Approve visit* tile, OE only, becomes tappable → `/approve-visit`):
- List for the selected date: TK id, technician, customer, site, "Submitted 4:12 pm". Empty: "Nothing waiting for you on this day". Pull to refresh.
- **Detail** (`/approve-visit/[id]`): the technician's form read-only (reuse the summary's sections) and photos (thumbnails → full screen); then the verification fields: **Issue observed**, **Action taken**, **Final issue** (pickers from `/api/lookups`; the final issue shows "Billable"/"Not billable"), **Accessories** (multi-select), **OE remarks** (text, ≤ 1000). Keyboard padding (D-177/D-178).
- **Verify** (sticky footer): checks the three required fields locally (list what's missing), then `POST /api/fitments/:fid/transitions {action: 'VERIFY', payload: {...fields}}`; a server `VERIFICATION_INCOMPLETE` (or whatever the existing code is) shows the same message. Success → toast "TK-00012 verified", then open the next waiting fitment (replace), or go back to the list when none is left. Invalidate home, approve-visit and history queries.
- **Reopen**: a dialog with a reason (min length from the shared `REOPEN_REASON_MIN`) → `POST …/transitions {action: 'REOPEN', payload: {reason}}` → same "next" behaviour.
- A 409 (someone else verified it meanwhile) → toast and back to the list.

## 6. Mobile tests (Jest)
- history: totals line (routed and approx), entries and steps in IST, connectors, empty state, date change refetch, OE tabs vs OT none, reportees list → reportee timeline
- approve visit: tile navigation (OE only), list and empty state, detail renders form and photos, Verify blocked until the three fields are chosen, VERIFY body, next-item navigation, Reopen dialog and body, 409 handling

## 7. Backend tests
- router: OSRM `route` URL and parsing; straight-line `route`; stub
- history: day selection (started on D, closed without start on D, steps only from D); distance from start order with same-site merge; approx fallback; cache hit/miss on signature; access (self, OE → reportee, OE → non-reportee 403, OT → other 403)
- reportees: OE only; list with counts; no OSRM call (stub records calls)
- approve visit: list equals the home count for the date; only own tasks; detail 404 for another OE's task; OT 403; VERIFY/REOPEN through the existing endpoint by a mobile token still work (one smoke test)

## 8. Definition of done
- **Backend:** migration applied to the dev DB; full gates once at the end (failures only inside `apps/mobile` are reported, not fixed).
- **Mobile:** `pnpm --filter @champ/mobile test`, mobile typecheck, root lint, `expo-doctor`, `expo export` for both platforms (after Backend has committed the contracts).
- Each agent reports its wall time, debugging minutes, proposed decisions (Backend B-1…, Mobile M-1…) and README notes. Claude writes the docs and smoke-tests the flow; no native rebuild should be needed (no new native modules).
