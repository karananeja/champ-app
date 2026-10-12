# F11 — Test Report

| | |
|---|---|
| Date | 2026-10-12 |
| Branch | `feature/F11-mobile-csv-bulk-fill` |
| Environment | macOS, Node 24, pnpm 10, Docker (postgres:16-alpine, MinIO), Chromium (Playwright), Xcode 26.6 (iPhone 17 simulator), Android emulator Pixel_10_Pro |
| Result | **All gates pass**: typecheck, lint, 1,115 unit/integration tests, 69 E2E tests (4 skipped by design), build, expo-doctor, export for both platforms, **new native builds for iOS and Android**, and a CSV round trip through the API |

## 1. Agent timing (D-127): two parallel agents

| Agent | Wall time | Debugging | Notes |
|---|---|---|---|
| Backend (shared, API, web) | **~16 min** | ~3 min | Shared contracts committed first; full E2E took 5 min of it |
| Mobile | **~7 min** | ~1 min | Typechecked against the committed contracts |

The feature took ~16 min of wall time from launch to the last agent's finish.

## 2. Definition of done

| Step | Result |
|---|---|
| Migration | **None needed**: `TaskEvent.type` is a string; `FITMENT_FORM_CSV_FILLED` was added to the shared event types (D-206) |
| New dependencies (mobile) | expo-document-picker 57.0.3, expo-sharing 57.0.22 (config plugin added) |
| Native iOS build | prebuild + pods + `expo run:ios`: **Build Succeeded**, installed on the iPhone 17 simulator |
| Native Android build | prebuild + `expo run:android`: **BUILD SUCCESSFUL**, installed on the Pixel_10_Pro emulator |
| expo-doctor / export | 21/21; iOS and Android bundles built |

## 3. Quality gates (re-run by Claude after both agents finished)

| Command | Result |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm test` | exit 0: **1,115 passed / 0 failed** (shared 430, api 196, web 368, mobile 121) |
| `pnpm test:e2e` | exit 0: **69 passed / 4 skipped** |
| `pnpm build` | exit 0 |

New tests: shared `test/bulk-fill.test.ts` (19: cell parsing and `csvRowToForm`), api `test/bulk-fill.test.ts` (11: bulk status, sample, file and row checks, confirm with starts/blanks/GPS/stale rows, route order within and across tasks, submit ready), web 1 ("Filled from CSV" in the raw history), mobile 16 (bulk screen 11, photos walk-through 2, fitment screen 2, route 1).

## 4. CSV round trip (Claude, a throwaway test run against the `_test` database, not committed)

| Step | Result |
|---|---|
| Download the sample for a 3-vehicle task | Header + 3 rows (`TK-00001`…), UTF-8 BOM, CRLF |
| Upload it filled like a spreadsheet export (BOM, `.txt` name, quoted cells, `"1,234"`, `ok` / `not ok` / `N/A` / `Not applicable`, `device`, lower-case device ids, a blank comment, `Nto OK` typo on row 4, trailing blank lines) | Preview: **2 ready, 1 with problems, 2 will be started**; row 4 "Accessories: Use OK, Not OK or NA" |
| Confirm without a fix | 400 `GPS_REQUIRED`, nothing written |
| Confirm with a fix | Both started and filled; the third stays Assigned |
| Bulk status | Each started fitment misses only its 5 photos (device placement because replacement = Device) |
| Upload the 5 photos for the first one (real JPEGs) | 201 each |
| *Submit ready* | Submitted `TK-00001`; `TK-00002` incomplete with its 5 photos; `TK-00003` skipped (not started) |
| History event | "Filled from CSV" with a readable diff, e.g. `"Device id": [null, "DEV-0A"]`, `"Cluster reading (km)": [null, "1234"]`, `"Comments": [null, "Fitted, all good"]` |

## 5. Not verified by Claude: check in UAT
Your Metro, API and web were running, and the new builds open against your Metro, so I didn't drive the app:
- **Share sheet and file picker** (new native modules): sharing the sample to Files/Drive and picking the filled CSV, on both platforms. On the iOS Simulator, save to *Files* first, then pick it from there.
- **The screens on a device:** preview layout with many rows, the walk-through, and the result dialogs.

## 6. Known limitations
- CSV only (no .xlsx), no photos in the CSV, and the web can't upload a technician's CSV (intent: out of scope).
- The preview doesn't check the route order: if a fitment of **another** task is in progress, *Confirm* reports `ROUTE_ORDER` for the rows that need starting (shown in the result dialog) and fills the rest.
- A CSV can't clear a field (D-205); clear it in the form.
- Online only (D-008).

## 7. UAT checklist (intent acceptance criteria)

**Before you start:**
- The new Champ Dev builds are already installed on the iPhone 17 simulator and the Pixel_10_Pro emulator. On another machine: pull, `pnpm install`, then `npx expo run:ios` / `npx expo run:android`.
- Run `pnpm dev` and `pnpm --filter @champ/mobile start`.
- As OM/OE on the web, create a task with 3+ vehicles for today and assign them all to one technician.

| # | Acceptance criterion | Manual steps | Expected |
|---|---|---|---|
| 1 | Entry only for 2+ fitments | Open one of the task's fitments, and a fitment of a single-vehicle task | *Bulk fill (CSV)* on the first, not on the second; *Bulk fill* link on the task's first route stop |
| 2 | Sample CSV | *Download sample CSV* → save to Files/Drive | One row per fitment, TK ids and known reg/chassis filled |
| 3 | Preview | Fill it in Sheets/Excel/Numbers (one row with a typo like "Nto OK"), export CSV, *Upload CSV* | Green valid rows with values, red row with the reason per cell, counts "x ready, y with problems · z will be started" |
| 4 | Confirm, start with one fix, blanks keep values | Fill a field in one fitment's form first and leave that cell blank in the CSV; *Confirm*; try once with location off | Location off: message, nothing saved. On: valid rows filled, not-started fitments now In progress, the pre-filled field kept |
| 5 | Values in the forms; history | Open a filled fitment's form; on the web open the task's *Raw data* history | Values present; "Filled from CSV" with the changes |
| 6 | Missing photos and walk-through | Bulk screen → *Add photos* | Steps through each fitment's missing photos in order, *Skip*/*Next* |
| 7 | Submit ready | Complete one fitment's photos, *Submit ready* | That one Submitted; the others listed with what's missing |
| 8 | Android and iOS; tests pass | Repeat 2–3 on the other platform | Works; §3 green |
