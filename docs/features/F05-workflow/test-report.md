# F05 — Test Report

| | |
|---|---|
| Date | 2026-10-12 |
| Branch | `feature/F05-workflow` |
| Environment | macOS, Node 24, pnpm 10.33, Docker (postgres:16-alpine, pgsty/minio), Chromium (Playwright 1.64) |
| Result | **All gates pass**: typecheck, lint, 583 unit/integration tests, 37 E2E tests (2 skipped by design), build with bundle check |

## 1. Definition of done

| Step | Command | Result |
|---|---|---|
| Migrate (dev DB with F01–F04 data) | `pnpm db:migrate` | `20261012100000_workflow` applied on top of the four earlier migrations. Additive only: 18 nullable/defaulted columns on `Fitment`, the `ReopenAttribution` table, indexes and FKs. Row counts before/after: User 5/5, Task 5/5, Fitment 10/10, TaskEvent 7/7, LookupItem 80/80, Client 1/1 |
| Run | `pnpm dev` | API :4000 and web :5173; `/api/health` `{"ok":true,"db":"up"}`, `/api/config` `{"googleClientId":null,"devSimulator":true}` (no `ENABLE_DEV_SIMULATOR` in the local `.env`, so the development default applies) |
| Smoke test (curl/fetch through the web proxy) | SA creates a 1-vehicle task (OE Suraj, technician Satish) → `APPROVE` → simulator `START`, `SUBMIT` → OE `VERIFY` → `GET /fitments/awaiting-approval` → `POST /fitments/approve` → `GET /tasks/:id`, `/history`, `/events?format=csv` | 201 `OM-00006`/`TK-00011`; APPROVE 409 *"This fitment is Assigned; only OE-verified fitments can be final-approved"*; START/SUBMIT 200 (IN_PROGRESS, SUBMITTED); VERIFY 200 (OE_VERIFIED); the fitment listed as awaiting; approve `{"approved":["TK-00011"],"failed":[]}`; task **COMPLETED**, fitment OM_APPROVED; all four task stages completed; CSV 200 with the header and 5 events. The OE token was minted with the app's own JWT signer (the OE's password isn't known); nothing was changed on that account |
| Clean-up | SQL | The smoke task, its fitment and 5 events were deleted and the counters reset to OM 5, OE 5, TK 10, so the dev DB is as before (5 tasks, 10 fitments, 7 events). The SA login left one refresh-token row. Servers stopped; no processes left running |

## 2. Quality gates

| Command | Result |
|---|---|
| `pnpm typecheck` | exit 0 (shared, api, web) |
| `pnpm lint` | exit 0: 0 errors, 0 warnings |
| `pnpm test` | exit 0: **583 passed / 0 failed** (shared 231, api 262, web 90) |
| `pnpm test:e2e` | exit 0: **37 passed / 0 failed / 2 skipped** (the CR-02 sidebar and read-only specs run on desktop only) |
| `pnpm build` | exit 0; *"Bundle check: no dev simulator in dist"* |

| Suite | Before (F04 + CR-01/02) | After |
|---|---|---|
| `packages/shared` | 141 | **231** (+90, `test/workflow.test.ts`) |
| `apps/api` | 238 | **262** (+24: `workflow.test.ts` 15, `workflow-views.test.ts` 8, `health.test.ts` +1) |
| `apps/web` | 74 | **90** (+16: `workflow.test.tsx` 10, `task-history.test.tsx` 3, `prod-bundle.test.ts` 1, `App.test.tsx` +2) |
| E2E | 29 + 2 skipped | **37 + 2 skipped** (+8: `workflow.spec.ts`, 4 tests × 2 viewports) |

### 2.1 Shared (`test/workflow.test.ts`)
The **full transition table** (7 actions × 9 statuses = 63 cases, allowed or refused) and the refusal messages;
**canPerform** for every action against SA, OM, the task's OE, another OE, the assigned OT, another OT and RO, plus
no-technician and id-collision cases; **availableActions** per role and status; the **canEditFitmentData matrix**
(assigned OT, other OT, task OE, other OE, OM, SA, RO × every status) and `isPostApprovalEdit`; the amended assign
rule (`statusAfterAssignment`, Reopened assignable, not "untouched"); history/approver roles; payload schemas (START
GPS, CLOSE_NOT_DONE reason + comments, MARK_FAULTY reason, REOPEN 3–500, optional notes, unknown action, simulate,
bulk approve 1–200, list query).

### 2.2 API (against `champ_test`)
- `workflow.test.ts`: **happy path to COMPLETED** (events, timestamps, coordinates, availableActions per viewer);
  OT acts through `/fitments` while `/tasks` stays 403; **every out-of-order step → 409 with its message**;
  **wrong actor → 403** (other technician, OE/OM starting, unassigned fitment, OE of another task verifying, OM/SA
  verifying, RO and other OE reopening, OE/OT/RO approving); 404 for unknown/deleted, 401 without token; **START needs
  lat/lng**, **CLOSE_NOT_DONE needs an active close reason** (missing, wrong kind, inactive) and comments; MARK_FAULTY
  without reason, note > 500. **MARK_FAULTY** creates the replacement (new TK, seq, Open, unassigned, vehicle copied,
  linked both ways), the task becomes Open, both events, the OE assigns the replacement and the faulty one is locked.
  **REOPEN**: OE reopen → technician only; OM reopen of OE-verified → OE + technician, verification cleared and kept
  in history; OM/SA reopen of Closed – not done / Submitted → technician; repeated reopens count again; no reason / 2
  characters → 400; OM_APPROVED → 409; a reopened fitment is redone by the same OT, reassigned (stays Reopened),
  unassigned (Open) and started by the new OT. **Concurrency**: two simultaneous APPROVE → one 200, one 409, one event;
  concurrent approvals of a task's last two fitments still complete the task. **approveMany** mixed results (approved,
  wrong status, unknown id, duplicate), OE/RO 403, 0 or 201 ids → 400. **canEditData** per role before/after approval.
- `workflow-views.test.ts`: **awaiting-approval** (order, fields, client/OE/technician/date filters; OE, RO, OT 403);
  **reopened** (count, latest reason/who, `current=true`, OE own tasks only, RO reads, filters, paging, OT 403, bad
  date 400); **faulty** (fault reason, replacement with status and technician, OE scope, RO, OT 403, deleted tasks
  hidden); **history** stages of the current cycle, reopen loops with attributions, task aggregate completing once the
  other fitment is closed, OE/RO/OT 403, 404; **events** JSON with `postStart` / `postApproval` flags and CSV
  (header, BOM, file name, JSON data column), bad format 400; **simulator**: 404 when not mounted,
  `devSimulatorEnabled` rules (never in production), actor = technician, START at the site's location or given
  coordinates, `simulated` flag only on simulated events, response built for the caller, caller permissions (other OE,
  RO, OT 403), no technician 409, non-technician step 400, out-of-order 409.
- `tasks.test.ts` (updated for intentional F05 changes): permission flags gain `canViewHistory`, SA/OM keep `canEdit`
  after work starts, a Reopened fitment makes `canAssign` true; header edit after a start: OE 409 `TASK_STARTED`, OM 200
  with `postStart: true`; fitment data edit: OE allowed on Submitted, 409 `FITMENT_LOCKED` ("TK-00002 is OM approved,
  so you can no longer change it.") after approval, OM 200 with `postApproval: true`.
- `health.test.ts`: `/config` includes `devSimulator`.

### 2.3 Web (jsdom)
- `workflow.test.tsx` (10): **action buttons exactly per `availableActions`**, status badges, reopen chip, fault/close
  reasons and replacement links, phone actions menu; **reopen dialog validation** (empty and 2-character reasons
  refused without an API call, then the body sent); OM reopen of OE-verified mentions the OE; a 409 message shown
  verbatim; **bulk final approve**; History tab only with `canViewHistory`; **simulator hidden when `devSimulator` is
  false**, shown for the OM when true (runs START), not offered to another OE.
- `task-history.test.tsx` (3): **history rendering from a fixture** (stepper states, IST times, reopen loop and
  attributions, raw rows, before → after diff), event filter, CSV download; `eventDetails`.
- `prod-bundle.test.ts` (1): **production build in a temp dir, grepped for the simulator markers** (absent) while the
  rest of F05 (e.g. *Awaiting approval*) is present. A development-mode build was also checked by hand: it contains
  `SimulatorPanel-*.js` and `scripts/check-prod-bundle.ts` rejects it (exit 1).
- `App.test.tsx` / `nav.test.ts`: Awaiting approval for SA/OM only; Faulty/Re-opened are real lists; Travel stays a
  placeholder.

### 2.4 E2E (desktop 1280×720 and mobile 360×740), `e2e/workflow.spec.ts`
1. **Full flow to Completed**: OE (no History tab) simulates Start and Submit, verifies; OM final-approves; task
   *Completed*; History shows 4 completed stages and 5 raw events; CSV download fires.
2. **Reopen, then redo**: reason required in the dialog; status Reopened ×1; listed in Re-opened with count 1, reason
   and technician; the technician redoes it and the OE verifies again.
3. **Mark faulty**: fitment Moved to FT with the reason, a linked Open replacement, task back to Open; the OE assigns
   the replacement to the second technician; the Faulty view shows the fault and the replacement (TK, Assigned,
   technician).
4. **OM bulk approve** from Awaiting approval (two fitments pre-verified in setup) → both OM approved, task Completed.

Every page is checked for horizontal overflow. The setup project now also creates an F05 OM, OE and two technicians
and per-viewport tasks (D-083).

## 3. Known limitations
- **No real technician app yet.** OT steps run only through the dev simulator (or the API with an OT token); the
  OT's own data edits arrive with the mobile API (F10). START's location in the simulator is the site's pin.
- **Verify is a confirmation only.** OE verification fields, image correction and the "OE doing the fitment" path are
  F06 / F09–F10 (D-078).
- **History is derived from events.** Tasks started before F05 have no workflow events; a stage shows the latest
  occurrence in the current cycle (after the last reopen). Raw data is filterable by fitment only (no text search).
- **Bulk approve** handles at most 200 fitments per request, sequentially (each in its own transaction).
- **Reopen attribution** is stored, not yet reported (analytics in F15).
- Closing a reopened fitment keeps the previous close reason fields until the next close (shown only while the status
  is Closed – not done).

## 4. UAT checklist

0. [ ] `pnpm db:migrate`, `pnpm db:seed`, optionally `pnpm db:seed:demo`, then `pnpm dev`. Make sure the simulator is
   on: `/api/config` shows `"devSimulator":true` (it is by default in development; `ENABLE_DEV_SIMULATOR=true` in
   `.env.example`). You need an OM, an OE and a technician (demo: `demo.om@`, `demo.oe@`, `ravi.ot@` …
   `@intellicar.in`, password `Demo@1234`). As the OM create a task for 2–3 vehicles with OE = your OE and a
   technician.

| AC | Steps | Expected |
|---|---|---|
| 1 | As the OE open the task → *Simulate technician (dev only)* → *Start work*, then *Submit*. Click *Verify* on the fitment → confirm. Sign in as the OM → open the task → *Final approve* → confirm. Do the same (or *Close not done*) for every other fitment | Fitment goes Assigned → In progress → Submitted → OE verified → OM approved; task status In progress, then **Completed** once every fitment is OM approved / Closed – not done / Moved to FT |
| 2 | Call an out-of-order step, e.g. via the simulator *Submit* on an Assigned fitment is disabled; or with `curl -X POST /api/fitments/<id>/transitions -d '{"action":"APPROVE"}'` (OM token) on a Submitted fitment | Refused with 409 and a clear message, e.g. *"This fitment is Submitted; only OE-verified fitments can be final-approved"*; nothing changes |
| 3 | After the OE verifies: the technician's data-edit right ends (shared rule, unit-tested; the OT edit screen comes in F10). After the OM approves, sign in as the OE: the fitment has no vehicle *Edit* pencil (API returns 409). As the OM edit the vehicle → Save, then open *History → Raw data* | OE can't change an OM-approved fitment; the OM can; the raw event *Fitment edited* shows *before → after* and `postApproval: true` |
| 4 | As the OE, on a Submitted fitment click *Reopen*, try with an empty reason, then give a reason. Open Tasks → *Re-opened* | Empty/short reason refused ("Give a reason for reopening (at least 3 characters)"). Fitment shows *Reopened ×1*; Re-opened lists it with count 1, the reason, who and when; the technician gets a reopen attribution (in History → Reopen loops: "Counts against: <technician> (OT)") |
| 5 | Simulator → *Mark faulty* with a reason. Tick the new fitment → choose a technician → *Assign*. Open Tasks → *Faulty tasks* | Fitment is *Moved to FT* with the fault reason; a new **Open** fitment (new TK id, "Replacement for TK-…") appears in the same task and the task goes back to Open; the OE assigns it; the Faulty view shows the faulty fitment with the replacement's TK id, status and technician |
| 6 | Simulator → *Close not done*: try confirming without a reason (button disabled), then pick a close reason and add comments. As the OE click *Reopen* on it with a reason | Closed – not done with "Not done: <reason> — <comments>"; the OE can reopen it (status Reopened) |
| 7 | As the OM open a task → *History* tab; expand a fitment; open *Raw data*, filter by a TK id, expand *Details*, *Download CSV*. Sign in as the OE and as an RO and open the same task | OM sees the task stepper (First → Second → Verification → Final with IST times and names), per-fitment steppers with reopen loops, and every event with before/after values; the CSV downloads. OE and RO see no History tab (API 403) |
| 8 | As the OM: Tasks → *Awaiting approval* → tick several OE-verified fitments → *Final approve (n)* → confirm. (Also possible on the task page with the fitment checkboxes.) | "Final-approved n fitment(s)"; they leave the list and show OM approved |
| 9 | `pnpm build`, then `grep -r "Simulate technician" apps/web/dist` (or `pnpm --filter @champ/web preview`) | Build prints "Bundle check: no dev simulator in dist"; grep finds nothing; the preview's task page has no simulator panel |
| 10 | Repeat a few steps at 360 px (DevTools device mode): task page actions menu (⋯), History, Re-opened, Faulty, Awaiting approval. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e` | Cards instead of tables, no sideways scrolling, vertical stepper; all commands pass |
