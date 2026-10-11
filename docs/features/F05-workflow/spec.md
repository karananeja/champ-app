# F05 — Technical Spec

Implements `intent.md` (approved 2026-10-12). Binding decisions: D-011, D-012, D-014, D-027, D-033, D-065, D-073–D-078, plus everything from F01–F04 and CR-01/02. Follow the existing structure and conventions. F04's `apps/api/src/modules/tasks/` (status.ts, service, refs, filters, dto) and `packages/shared/src/tasks.ts` are the base to extend. Reuse; don't duplicate.

## 1. State machine (shared, single source of truth, D-077)

`packages/shared/src/workflow.ts`:

```ts
type FitmentAction = 'START' | 'SUBMIT' | 'CLOSE_NOT_DONE' | 'MARK_FAULTY' | 'VERIFY' | 'APPROVE' | 'REOPEN';

const TRANSITIONS: Record<FitmentAction, { from: FitmentStatus[]; to: FitmentStatus }> = {
  START:          { from: ['ASSIGNED', 'REOPENED'],                      to: 'IN_PROGRESS' },
  SUBMIT:         { from: ['IN_PROGRESS'],                               to: 'SUBMITTED' },
  CLOSE_NOT_DONE: { from: ['ASSIGNED', 'IN_PROGRESS', 'REOPENED'],       to: 'CLOSED_NOT_DONE' },
  MARK_FAULTY:    { from: ['ASSIGNED', 'IN_PROGRESS', 'REOPENED'],       to: 'MOVED_TO_FT' },
  VERIFY:         { from: ['SUBMITTED'],                                 to: 'OE_VERIFIED' },
  APPROVE:        { from: ['OE_VERIFIED'],                               to: 'OM_APPROVED' },
  REOPEN:         { from: ['SUBMITTED', 'OE_VERIFIED', 'CLOSED_NOT_DONE'], to: 'REOPENED' },
};
```

Actor rules, as `canPerform(action, actor, ctx)` where `ctx = { task: {oeId}, fitment: {technicianId, status} }`:
- START, SUBMIT, CLOSE_NOT_DONE and MARK_FAULTY are allowed only for the assigned technician (`fitment.technicianId === actor.id`, actor role OT). The dev simulator acts as that technician (§4).
- VERIFY: an OE with `task.oeId === actor.id`.
- APPROVE: SA or OM.
- REOPEN: SA or OM, or an OE with `task.oeId === actor.id`.

Also export:
- `availableActions(actor, ctx)`, which the web uses to show buttons.
- `canEditFitmentData(actor, ctx)` for the edit locks:
  - OT (assigned): status ∈ {ASSIGNED, IN_PROGRESS, SUBMITTED, REOPENED}.
  - OE (own task): status ≠ OM_APPROVED.
  - SA or OM: any status.
- `isPostApprovalEdit(status)`: true when status = OM_APPROVED.

Assign rule (amends F04): allowed while the status is OPEN, ASSIGNED or REOPENED. Assigning keeps REOPENED as REOPENED. Unassigning a REOPENED fitment sets it to OPEN.

Payload validation (zod, discriminated on action):
- START: `{ lat, lng }`, required.
- CLOSE_NOT_DONE: `{ closeReasonId (active CLOSE_REASON), comments (1..1000) }`.
- MARK_FAULTY: `{ reason (1..500) }`.
- REOPEN: `{ reason (3..500) }`.
- Other actions: empty.
- Every action accepts an optional `note` (≤500).

## 2. Data model changes (Prisma migration on top of F04)

Additions to `Fitment`:

```prisma
startedAt DateTime?  startLat Float?  startLng Float?
submittedAt DateTime?
verifiedAt DateTime?  verifiedById String?
approvedAt DateTime?  approvedById String?
closedAt DateTime?  closeReasonId String?  closeComments String?
faultyAt DateTime?  faultReason String?
replacementOfId String? @unique        // set on the replacement; relation "Replacement" (one-to-one back to original)
reopenCount Int @default(0)
lastReopenReason String?  lastReopenedAt DateTime?  lastReopenedById String?
```

New model:

```prisma
model ReopenAttribution {      // D-074: one row per person a reopen counts against
  id         String   @id @default(cuid())
  eventId    String               // TaskEvent of type FITMENT_REOPENED
  fitmentId  String
  userId     String
  role       Role                 // OT or OE at the time
  createdAt  DateTime @default(now())
  @@index([userId]) @@index([fitmentId])
}
```

New TaskEvent types:
- `FITMENT_STARTED`, `FITMENT_SUBMITTED`, `FITMENT_CLOSED_NOT_DONE`, `FITMENT_MARKED_FAULTY`, `FITMENT_REPLACEMENT_CREATED`, `FITMENT_VERIFIED`, `FITMENT_APPROVED`, `FITMENT_REOPENED`.
- Data carries the payload, plus `simulated: true` when done through the simulator, and `postApproval: true` on edits after approval.

When a fitment is reopened, clear `verifiedAt/By` and `approvedAt/By` (history keeps them). Keep the start/submit timestamps until the next START overwrites them.

## 3. Engine (API)

`apps/api/src/modules/workflow/engine.ts` exports `transitionFitment(actor, fitmentId, action, payload, opts?)`. In one transaction it:
1. Loads the fitment and task with `SELECT … FOR UPDATE` on the fitment row (raw query, or update-where-status guard). The task must not be deleted.
2. Checks `canPerform`. Failure → 403 `FORBIDDEN`.
3. Checks `from`. Failure → 409 `INVALID_TRANSITION`, with a message naming the current status and the action, e.g. "This fitment is Submitted; only OE-verified fitments can be final-approved".
4. Validates payload references (close reason active).
5. Applies the status and the timestamp fields.
6. **MARK_FAULTY:** creates the replacement fitment. It gets a new TK number (counters helper), `seq = max(seq)+1`, `status OPEN`, `technicianId null`, copies the vehicle fields and sets `replacementOfId = original.id`. Writes a `FITMENT_REPLACEMENT_CREATED` event.
7. **REOPEN:** `reopenCount++`, last-reopen fields, and attributions per D-074:
   - OE actor → the technician.
   - OM/SA actor from OE_VERIFIED → the task's OE and the technician.
   - OM/SA actor from another status → the technician.
   - If no technician is set, skip that row.
8. Writes the TaskEvent (from/to status).
9. Calls `recomputeTaskStatus`, updated so that REOPENED counts as in progress. COMPLETED means every fitment ∈ {OM_APPROVED, CLOSED_NOT_DONE, MOVED_TO_FT}; an OPEN replacement keeps the task OPEN, which is correct.
10. Returns the updated fitment and the task summary.

`approveMany(actor, fitmentIds[])`: OM/SA only, ≤200 ids. Each id is processed in its own transaction. Returns `{ approved: [tkId], failed: [{ tkId, code, message }] }`.

**Fitment data edits:** `PATCH /tasks/:id/fitments/:fid` (from F04) now uses `canEditFitmentData` instead of "OPEN/ASSIGNED only". A post-approval edit sets `postApproval: true` in the event. Because OT is blocked from the `/tasks` router, OT data edits arrive with the mobile API in F10; F05 only needs the rule, plus tests through the shared function.

**Task header edit** (F04 PATCH /tasks/:id):
- OE: unchanged (only while untouched).
- SA/OM: allowed at any stage. If the task has any fitment past ASSIGNED, the event is flagged `postStart: true`.

Delete stays untouched-only.

## 4. Dev simulator (D-073)
- Env `ENABLE_DEV_SIMULATOR`: default `true` in `.env.example` for local dev, forced false when `NODE_ENV=production`. `GET /config` adds `devSimulator: boolean`.
- Route `POST /api/dev/fitments/:fid/simulate` with `{ action: START|SUBMIT|CLOSE_NOT_DONE|MARK_FAULTY, payload? }`.
  - Mounted only when enabled; otherwise 404.
  - Caller must be SA, OM, or the task's OE.
  - The fitment must have a technician. The actor becomes that technician, loaded from the DB.
  - START defaults lat/lng to the site's coordinates.
  - Calls `transitionFitment` with `{ simulated: true }`.
- Web: the panel is rendered only when `import.meta.env.DEV && config.devSimulator`. In production builds the panel code must be tree-shaken out, e.g. behind `import.meta.env.DEV` with a lazy import. Add a build test that greps the built bundle for the panel's marker string and expects it to be absent.

## 5. API routes (prefix `/api`)

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/fitments/:fid/transitions` | any authenticated; rules in engine | `{ action, payload? }`, returns `{ fitment, task }`. OT may use it for own fitments |
| POST | `/fitments/approve` | SA, OM | `{ fitmentIds }`, returns approveMany's result |
| GET | `/tasks/:id` | as F04 | Each fitment now also carries `availableActions` for the caller, the new timestamp fields, close reason name, fault reason, `replacementOf {id,tkId}` / `replacement {id,tkId,status}`, `reopenCount` and `lastReopenReason`. Permission flags also include `canViewHistory` |
| GET | `/fitments/awaiting-approval` | SA, OM | OE_VERIFIED fitments across tasks, paged, filters: client, OE, technician, date |
| GET | `/fitments/reopened` | SA, OM, OE (own tasks), RO | Fitments with `reopenCount > 0`: tkId, task omId, client, technician, OE, reopenCount, lastReopenReason, lastReopenedAt/By, current status. Filters: technician, OE, client, from/to (lastReopenedAt), `current=true` (status REOPENED only). Paged |
| GET | `/fitments/faulty` | same | Fitments with status MOVED_TO_FT: tkId, task, client, technician, faultReason, faultyAt, replacement {tkId, status, technician}. Same filters |
| GET | `/tasks/:id/history` | SA, OM | `{ task: StageTimeline, fitments: [{ tkId, stages: StageTimeline, reopenLoops }] }`. StageTimeline is `{ first: {at, by}, second, verification, final }` (each nullable), derived from events: first = created/assigned, second = started (submitted as `secondCompletedAt`), verification = verified, final = approved. Reopen loops list every reopen with reason, actor and attributions |
| GET | `/tasks/:id/events` | SA, OM | Raw event log, `format=json\|csv`, with actor name, fitment tkId, type, from/to, data (JSON string in CSV) |

## 6. Web
- **Task detail:** the fitments table gets a status badge per fitment (colours consistent across the app; add a shared `FitmentStatusBadge`) and per-row action buttons from `availableActions`.
  - Verify, Approve and Reopen open confirm dialogs. Reopen requires a reason.
  - Multi-select bulk "Final approve" for OM.
  - Replacement links, a reopen-count chip, and the close reason or fault reason shown inline.
  - On mobile, rows become cards with an actions menu.
- **Simulator panel:** a collapsible card titled "Simulate technician (dev only)", with a fitment select and Start/Submit/Close not done (reason select + comments)/Mark faulty (reason) buttons, enabled by status.
- **History tab:** tabs on the task page, "Details | History" (History only when `canViewHistory`).
  - History shows a horizontal stepper (vertical on mobile) for the task and an expandable per-fitment stepper with timestamps (IST), actors and reopen loops.
  - Below that, a "Raw data" table (time, actor, fitment, event, from → to, expandable JSON diff) with a Download CSV button.
- **New pages:** replace the F04 placeholders.
  - `/tasks/reopened` and `/tasks/faulty`: tables, cards on mobile, with filters and links to the task.
  - Add `/tasks/awaiting-approval` ("Awaiting approval", OM/SA nav item) with a multi-select bulk approve.
- Toast and inline messages surface `INVALID_TRANSITION` messages verbatim.

## 7. Tests
- **Shared:** the full transition table (every action × every status → allowed or refused), canPerform for every role, canEditFitmentData matrix, availableActions.
- **API:**
  - The happy path to COMPLETED.
  - Every refusal: wrong status → 409 with message; wrong actor → 403, including an OE on another OE's task and an OT on someone else's fitment.
  - START requires lat/lng. CLOSE_NOT_DONE requires an active close reason.
  - MARK_FAULTY creates the replacement (new TK, linked, OPEN) and the task becomes OPEN.
  - REOPEN: counts and attributions for all three attribution cases. A reopen without a reason → 400. Reopen of OM_APPROVED → 409. A reopened fitment can be started by the same OT and reassigned.
  - Concurrency: two simultaneous APPROVE calls → exactly one succeeds.
  - approveMany with mixed results.
  - Data-edit locks per role, including the post-approval flag.
  - History stages and reopen loops. Events CSV.
  - reopened/faulty/awaiting-approval lists and scopes (OE own tasks, RO read, OT 403).
  - Simulator: 404 when disabled, actor = technician, `simulated` flag, caller permissions.
- **Web:** action buttons per availableActions, the reopen dialog validation, history rendering from a fixture, the simulator hidden when `devSimulator` is false, and the production-bundle grep test.
- **E2E** (desktop and 360 px, using the simulator; E2E env enables it):
  - Full flow to Completed.
  - Reopen, then re-do.
  - Mark faulty, assign the replacement, and see both in the Faulty view.
  - OM bulk approve from Awaiting approval.
  - OM sees History and raw data; OE does not.

## 8. Definition of done
- Migration applies on top of the current dev DB (which has demo data).
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e` and `pnpm build` all pass, and the bundle grep confirms there is no simulator in production.
- Dev smoke test through the simulator with curl, cleaned up afterwards. Leave no processes running.
- README updated (simulator, new env var).
- `test-report.md` includes a UAT checklist covering all 10 acceptance criteria.
