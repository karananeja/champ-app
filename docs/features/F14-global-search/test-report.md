# F14 — Test Report

| | |
|---|---|
| Date | 2026-10-12 |
| Branch | `feature/F14-global-search` (also carries CR-08) |
| Environment | macOS, Node 24, pnpm 10, Docker (postgres:16-alpine with pg_trgm, MinIO), Chromium (Playwright), iOS Simulator (CR-08 screenshot) |
| Result | **All gates pass** (re-run by Claude after CR-08 and the deflake): typecheck, lint, **1,214** unit/integration tests, build, **73 E2E passed / 4 skipped / 0 failed** |

## 1. Agent timing (D-127): two parallel agents

| Agent | Wall time | Debugging | Notes |
|---|---|---|---|
| Backend (shared, API) | **~7 min** | ~1 min | No E2E (only the Web agent ran it, per the F13 lesson) |
| Web | **~17 min** | ~2 min | ~2 min own E2E + 5.5 min full E2E, after the Backend's last commit |

No cross-agent test noise this time.

## 2. Definition of done

| Step | Result |
|---|---|
| Migration | `20261013000000_global_search` applied to the dev DB: `pg_trgm`, `SearchIdentifierSetting` (seeded, all on), six GIN trigram expression indexes; `prisma migrate status` up to date, `migrate diff` empty |
| New dependencies | None |

## 3. Quality gates

| Command | Result |
|---|---|
| `pnpm typecheck` / `pnpm lint` / `pnpm build` | exit 0 |
| `pnpm test` | exit 0: **1,214 passed** (shared 439, api 405, web 221, mobile 149) |
| `pnpm test:e2e` | exit 0: **73 passed / 4 skipped** (5.4 min), incl. `search.spec.ts` on desktop and mobile-360 |

New tests: shared 9 (`normalizeIdentifier`, `parseSearchId`), api 14 (every identifier, bare numbers, min length, grouping, ranking, limit/truncated, deleted hidden, literal `%`/`_`, disabled identifiers, settings rules, roles), web 13 (dialog, shortcut, grouping, highlight, targets, states; settings toggle/reorder/save/at-least-one/non-SA) + E2E (SA finds a fitment by "tk 000xx" and opens its sheet; switching *TK id* off hides it; switched back on).

## 4. Claude's verification
- Reviewed the search SQL: user input is always a bound parameter; column names come only from a fixed map; `%`, `_`, `\` are escaped.
- **Deflaked** `fitment-form.test.ts › refuses before reading the file` (failed with `write EPIPE` in F12 and twice in F14 agents' runs): an 11 MB body made the server's early refusal race the upload. It now sends a small non-image body (which would be 400 `UNSUPPORTED_FILE` if read), as the F06 photo test does. 3/3 alone, and green in the full run.
- CR-08 (tab icons) checked on the iOS Simulator.

## 5. Known limitations
- No fuzzy (typo) matching; no search by names, customers or free text; no search in the app (D-246).
- JS and Postgres normalise whitespace slightly differently (e.g. a non-breaking space); accepted for the MVP.

## 6. UAT checklist (intent acceptance criteria)

**Before you start:** pull, `pnpm --filter @champ/api db:migrate`, restart `pnpm dev`.

| # | Acceptance criterion | Manual steps | Expected |
|---|---|---|---|
| 1 | Device id search | Ctrl/⌘ K, type part of a device id from a submitted fitment | The fitment under its task, "Device id" with the match highlighted |
| 2 | Ids | Search `OM-…`, `oe 12`, `tk-000…`, `TT-…`, a bare number | Exact items found, with or without prefix and zeros |
| 3 | Other identifiers | Chassis no., asset no., old device id, secondary device id, reg no. (try lower case, spaces, hyphens) | Found |
| 4 | Open and phone | Enter on a fitment; repeat on a phone-width window via the search icon | Task opens with the fitment's sheet; works on the phone |
| 5 | SA settings | As SA, Settings → Search identifiers: switch *Device id* off, save; search a device id; as OM, look for Settings | Not found while off; OM has no Settings; switch it back on |
| 6 | Deleted, tests | Delete an untouched task, search its OM id | Not found; §3 green |
| — | **CR-08** | Open the app | Home, Route, History, Profile tabs show icons; the active one in the brand colour |
