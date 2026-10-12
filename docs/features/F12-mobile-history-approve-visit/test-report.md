# F12 — Test Report

| | |
|---|---|
| Date | 2026-10-12 |
| Branch | `feature/F12-mobile-history-approve-visit` |
| Environment | macOS, Node 24, pnpm 10, Docker (postgres:16-alpine, MinIO), Chromium (Playwright); public OSRM for one live check |
| Result | **All gates pass**: typecheck, lint, 1,139 unit/integration tests, 69 E2E tests (4 skipped by design), build, expo-doctor, export for both platforms, a live OSRM route check, and an end-to-end API round trip |

## 1. Agent timing (D-127): two parallel agents

| Agent | Wall time | Debugging | Notes |
|---|---|---|---|
| Backend (shared, API) | **~13 min** | ~2 min | Contracts committed first; full E2E took 5 min of it |
| Mobile | **~6 min** | ~1 min | Typechecked against the committed contracts |

## 2. Definition of done

| Step | Result |
|---|---|
| Migration | `20261012800000_day_distance` applied to the dev DB (additive: `DayDistance` table). `prisma migrate dev` named it `20261012111216_…`, which would sort before the existing migrations, so the agent renamed the folder and the matching row in the dev DB's `_prisma_migrations`; `prisma migrate status`: up to date |
| New dependencies | None. **No native rebuild needed** |
| expo-doctor / export | 21/21; iOS and Android bundles built |

## 3. Quality gates (re-run by Claude after both agents finished)

| Command | Result |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm test` | exit 0: **1,139 passed / 0 failed** (shared 430, api 378, web 196, mobile 135) |
| `pnpm test:e2e` | exit 0: **69 passed / 4 skipped** |
| `pnpm build` | exit 0 |

New tests: api `test/mobile-history.test.ts` (8) and 2 in `test/route.test.ts` (OSRM `route`, straight-line, stub); mobile 14 (history 6, Approve visit 8) plus the Home tile. The backend agent saw `fitment-form.test.ts > refuses before reading the file` fail once in a full run; it passed 3/3 alone and in every later full run, including mine (a flaky upload test, not F12).

## 4. Claude's checks

**Live OSRM route** (`OsrmRouter.route`, Indiranagar → Koramangala → Whitefield): legs 5.3 km and 17.3 km.

**API round trip** (a throwaway test against the `_test` database, not committed; real START/SUBMIT transitions by the technician):

| Step | Result |
|---|---|
| Technician starts and submits 2 fitments at one site and 1 at a far site | 200 each |
| `GET /history` | 13.4 km, 3 started; legs: first none, same site 0, far site 13.4 km; **one** route call |
| Same request again | Cached: still one route call |
| `GET /history/reportees` (OE) | Arjun 3 · 13.4 km (routed, from the cache); the others 0 |
| Access | OE → reportee 200; another OT → 403 |
| Home *Approve visit* count vs the list | 3 and 3 |
| Detail | Submitted; actions Verify, Reopen; 4 photos |
| VERIFY with no fields | 400 `VERIFICATION_INCOMPLETE` "Fill in Issue observed at site, Action taken, Final issue before verifying" |
| VERIFY with the fields; REOPEN another with a reason | OE verified; Reopened |
| Home count and list after | 1 and 1 |

## 5. Not verified by Claude: check in UAT
Your Metro and servers were running, so I didn't drive the app: the History tab layout, the pickers' bottom sheets and the next-fitment flow on a device.

## 6. Known limitations
- The distance follows the start positions, not the road actually driven (no background tracking, D-216).
- Photo replacement and the debug image are web-only (D-220).
- The public OSRM server is for development only (1 request/s).

## 7. UAT checklist (intent acceptance criteria)

**Before you start:** pull, `pnpm install`, `pnpm --filter @champ/api db:migrate` (new table), restart `pnpm dev` and Metro. The installed Champ Dev builds work as they are. As OM/OE on the web, make a few fitments for today at two or more sites, assigned to a technician whose manager is your OE.

| # | Acceptance criterion | Manual steps | Expected |
|---|---|---|---|
| 1 | Timeline and distance | As the technician, start and submit fitments at two sites; open **History** | Steps with IST times, "↓ x km" between sites (0 at the same site), the day total on top |
| 2 | Date and summary | Change the date chip; tap a fitment | That day's timeline; the summary opens |
| 3 | Direct reportees | Sign in as the OE → History → *Direct reportees*; tap the technician. As an OT, check History | Count and km per technician; their read-only day. The OT has no tabs |
| 4 | Approve visit list | OE → Home → *Approve visit* | The submitted fitments of the date; the count matches the tile |
| 5 | Verify on the phone | Open one, try *Verify* empty, then fill issue observed, action taken, final issue | Missing fields listed; then OE verified, the next one opens; on the web the status, history and billable show |
| 6 | Reopen | *Reopen* another with a reason | It goes back to the technician as Reopened |
| 7 | Android and iOS; tests | Repeat on the other platform | Works; §3 green |
