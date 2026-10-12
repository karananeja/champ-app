# F08 — Test Report

| | |
|---|---|
| Date | 2026-10-12 |
| Branch | `feature/F08-travel-tasks` |
| Environment | macOS, Node 24, pnpm 10.33, Docker (postgres:16-alpine, pgsty/minio), Chromium (Playwright 1.64) |
| Result | **All gates pass**: typecheck, lint, 876 unit/integration tests, 67 E2E tests (4 skipped by design), build with bundle check |

## 1. Definition of done

| Step | Command | Result |
|---|---|---|
| Migration | `pnpm db:migrate` | `20261012400000_travel_tasks` applied to the dev DB. **Additive only**: 2 enums (`TravelStatus`, `TravelSource`), 3 tables (`TravelTask`, `TravelTaskEvent`, `TravelAttachment`), indexes and foreign keys; no existing row or column changed. The `TT` counter is created by `pnpm db:seed` (or on first use) |
| New dependency | — | None |
| Dev-DB smoke | `GET /api/travel-tasks` and `GET /api/tasks/summary` as the seeded SA on `:4000` | 200, empty list; no data written, no tokens minted for real users |

## 2. Quality gates

| Command | Result |
|---|---|
| `pnpm typecheck` | exit 0 (shared, api, web) |
| `pnpm lint` | exit 0: 0 errors, 0 warnings (kebab-case file names included) |
| `pnpm test` | exit 0: **876 passed / 0 failed** (shared 376, api 311, web 189) |
| `pnpm test:e2e` | exit 0: **67 passed / 0 failed / 4 skipped** (existing desktop-only skips) |
| `pnpm build` | exit 0; *"Bundle check: no dev simulator in dist"*. Vite's existing "chunk larger than 500 kB" warning remains |

| Suite | Before (F07) | After |
|---|---|---|
| `packages/shared` | 333 | **376** (+43, `test/travel.test.ts`) |
| `apps/api` | 296 | **311** (+15, `test/travel.test.ts`; `seed.test.ts` and `tasks-summary.test.ts` updated for the TT counter and `travelToVerify`) |
| `apps/web` | 171 | **189** (+18 in `features/travel/*.test.tsx`; `app.test.tsx` and `dashboard-page.test.tsx` updated) |
| E2E | 65 + 4 skipped | **67 + 4 skipped** (+2: `travel.spec.ts` on desktop and at 360 px) |

### 2.1 Shared (`test/travel.test.ts`, 43)
TT id format/parse; `canRaiseTravel` for 7 actors (SA, OM, the technician's OE, another OE, the technician, another OT,
RO) and the MOBILE/WEB source; `canVerifyTravel` matrix (SA view-only); the transition table for every action × status
and the F05-style refusals; `canPerformTravel` matrix per action (RESUBMIT by the raiser even when an OT); `canEditTravel`
per status; receipt rights (editors, plus the verifier while Raised); `travelScope` / `isInTravelScope`;
`availableTravelActions` cases; create/update/transition schemas (future date, purpose bounds, distance bounds and
rounding, reasons).

### 2.2 API (`test/travel.test.ts`, 15)
- **Create:** OE for own technician (TT-00001, Raised, WEB, names, TT_RAISED event); OM and SA for any technician; OT for
  self (MOBILE); OE for another OE's technician, OT for someone else and RO → 403.
- **Validation:** future and impossible dates, missing/short purpose, missing technician, distance 0 and > 5,000
  (5,000 accepted, 12.34 → 12.3), inactive location/client/technician, non-OT technician, unknown related fitment and
  a fitment of a deleted task.
- **Options:** technicians per role (OE their own, OT self, RO 403).
- **List/detail scoping:** OE, other OE, OT, RO/SA/OM; out-of-scope detail 404; flags for RO/SA. **Filters:** technician,
  OE, customer, location, status, date range, TT id search (`TT-00002`, `tt-2`, `TT2`, `2`; text matches nothing), sorts,
  OE filters stay in scope, bad status 400.
- **Transitions:** verify (SA/RO/OT/other OE 403), double verify 409, locked edit 409 `TRAVEL_LOCKED`, reopen by OE 403 and
  without a reason 400, OM reopen clears the verification; reject needs a reason (400), resubmit by raiser with changes
  and by OM (others 403), future-dated changes 400, resubmit of a Raised TT 409; **concurrent verifies: one 200, one 409,
  one TT_VERIFIED event**.
- **Events with diffs:** TT_UPDATED with readable names (technician, location, customer, travel date, related task); no
  event when nothing changed; unchanged inactive location accepted; OE can't move a TT to another OE's technician, OM can.
- **Receipts:** JPEG (size read) and PDF accepted with `travel/{id}/{aid}.{ext}` keys and presigned URLs; text file 400
  `UNSUPPORTED_FILE`; > 10 MB 400 `FILE_TOO_LARGE`; missing file 400; 11th active receipt 409; remove keeps the row and
  the object, second remove 409, unknown 404; events. **Role/rule before parse:** RO, an OT for another technician,
  another OE, the TT's technician (not raiser) and SA → 403; unknown TT 404; OT raiser 201; verified TT 409.
- **Export:** CSV header (19 columns), formula-injection guard, scoping per caller, status filter; xlsx sheet "Travel
  tasks" with the same header.
- **Summary:** `travelToVerify` for OM (all Raised) and OE (their technicians'), absent for SA and RO, equal to the list.
- **`/fitments/lookup`:** number prefix (`1` → TK-1, TK-10…12), padded exact id, `tk 2`, deleted tasks skipped, OM ids and
  text match nothing, OT 403, missing `q` 400.

### 2.3 Web (18 new)
- `travel-form-dialog.test.tsx` (7): required-field validation and distance bound without any request; future dates
  disabled in the picker; OE with one technician → preset and hidden, body sent; OM picks a technician and the location
  follows their base city; receipts checked in the browser (text refused, PDF listed and removable); server refusal
  shown verbatim; resubmit sends `RESUBMIT` with the changes.
- `travel-detail-sheet.test.tsx` (7): fields and buttons from flags (Verify, Reject, Edit); RO read-only; Verify confirm;
  Reject reason validation and verbatim 409; OM Reopen with reason; Rejected shows the reason and Resubmit opens the form;
  image thumbnail, **PDF chip** (`target=_blank`), remove buttons, history with reasons and diffs.
- `travel-tasks-page.test.tsx` (4): **filters read from and written to the URL** (status, id search, clear); a row opens
  the sheet (`?tt=`); OE has no OE filter but Raise; RO has no Raise.
- Updated: dashboard card **Travel to verify** for OM/OE linking to `/tasks/travel?status=RAISED`; the Travel tasks
  route renders the real page.

### 2.4 E2E (`e2e/travel.spec.ts`, desktop and 360 px)
OE raises a TT (technician preset) with a JPEG receipt stored in MinIO (image loads), rejects it with a reason,
resubmits with an edited distance (history shows the reason and `12.5 → 15`), verifies it (no actions, no receipt
upload); OM filters by status and TT id (in the URL), downloads the CSV (one row with technician, type, OE, location,
distance and status), reopens with a reason, sees the dashboard card and follows it to the Raised list; RO opens it
read-only. No horizontal scroll at 360 px (checked once sheet/dialog animations settle).

## 3. Known limitations
- The OT side (raising from the field app) is API-only until F09/F10; the web hides *Raise* from OTs (they have no web
  task access).
- The list's technician filter offers every active technician (from `/tasks/options`); for an OE, other OEs'
  technicians simply give no results.
- A removed receipt is only visible in the history (the detail lists active receipts).
- The export shows *Rejected by/at/reason* only while the TT is Rejected; earlier rejections are in the history.
- The OE scope follows the technician's **current** reporting OE: if a technician moves to another OE, their TTs move
  with them.

## 4. UAT checklist (intent acceptance criteria)

| # | Acceptance criterion | Manual steps | Expected |
|---|---|---|---|
| 1 | OE raises a TT with all fields incl. a receipt image; it appears as TT-00001, Raised | Sign in as an OE with technicians → Tasks → Travel tasks → *Raise travel task*. Pick technician, location, customer, purpose, today's date, a related TK (type its number), distance, and add a JPEG. Save | Dialog closes; the detail sheet opens on `TT-00001` (first one on the system) with status **Raised**, every field and the receipt thumbnail (opens in the photo viewer). The row is in the list |
| 2 | OE only picks own technicians; OM any | As the OE open *Raise*: the technician list holds only your reportees (or is preset when you have one). As an OM: every active technician | As described |
| 3 | Travel date not in the future; purpose required; customer, related task, distance, receipts optional | In the dialog open the date picker: days after today are greyed out. Clear the purpose and save: "Describe the purpose of travel…". Save with only technician, location, purpose and date | Future days can't be picked; purpose error; the minimal TT saves |
| 4 | OE (or OM) verifies and it locks; reject needs a reason; raiser edits and resubmits; rejection stays in history | Open a Raised TT → *Reject* with no reason (error), then with a reason. As the raiser, *Resubmit*, change the distance, submit. Then *Verify* | Rejected shows the reason; resubmit makes it Raised with the change; history lists Raised → Rejected (reason) → Resubmitted (diff) → Verified. After verify no Edit/Reject buttons and no receipt upload |
| 5 | OM reopens a verified TT with a reason | As an OM open a Verified TT → *Reopen*, give a reason | Status Raised, reason in the history; it can be verified again |
| 6 | Filters, date range, TT id search; CSV and Excel export | Use each filter (technician, OE, customer, location, status, travel date range) and search `TT-1`/`1`; reload the page (filters stay, URL shows them). *Download → CSV / Excel* | Lists narrow as expected; files contain the filtered TTs with every column (TT id … attachments) and the status |
| 7 | RO read-only; an OE sees only their technicians' TTs | Sign in as an RO: list and detail open, no Raise/actions/receipt buttons. Sign in as a different OE: TTs of the first OE's technicians are absent (opening `?tt=<id>` shows "not found") | As described |
| 8 | OE dashboard "Travel to verify" count links to the filtered list | As an OE with a Raised TT, open the Dashboard | *Travel to verify* shows the count of Raised TTs of your technicians; clicking opens Travel tasks filtered to Raised (OMs get the same card for all TTs) |
| 9 | Works at 360 px; automated tests pass | Narrow the browser (or phone): list shows cards, dialog and detail are full screen, no sideways scrolling | As described; §2 shows all suites green |
