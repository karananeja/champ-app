# F13 — Test Report

| | |
|---|---|
| Date | 2026-10-12 |
| Branch | `feature/F13-notifications` |
| Environment | macOS, Node 24, pnpm 10, Docker (postgres:16-alpine, MinIO), Chromium (Playwright) |
| Result | **All gates pass**: typecheck, lint, 1,177 unit/integration tests, build, expo-doctor, export for both platforms, and E2E (71 passed, 4 skipped on the full rerun; one timing flake in the first run), including live Socket.IO delivery in the browser |

## 1. Agent timing (D-127): three parallel agents

| Agent | Wall time | Debugging | Notes |
|---|---|---|---|
| Backend (shared, API, Socket.IO, all dependency installs) | **~21 min** | ~3 min | ~8 min of it waiting for the Web agent's E2E run to free port 4100, then E2E |
| Web | **~18 min** | ~4 min | ~3 min iterating the E2E spec |
| Mobile | **~5 min** | ~2 min | |

Running full suites in parallel on the shared `_test`/`_e2e` databases caused cross-agent noise (unique-constraint failures, a removed `test-results` folder); all of it was clean on rerun. For three agents, only one should run the full gates.

## 2. Definition of done

| Step | Result |
|---|---|
| Migration | `20261012900000_notifications` applied to the dev DB (additive: `Notification`); `prisma migrate status` up to date |
| New dependencies | `socket.io` ^4.8.4 (api), `socket.io-client` ^4.8.4 (web, api dev) and 4.8.4 (mobile). Pure JS: **no native rebuild** |
| expo-doctor / export | 21/21; iOS and Android bundles built |

## 3. Quality gates (re-run by Claude after the fixes in §4)

| Command | Result |
|---|---|
| `pnpm typecheck` / `pnpm lint` / `pnpm build` | exit 0 |
| `pnpm test` | exit 0: **1,177 passed / 0 failed** (shared 430, api 391, web 208, mobile 148) |
| `pnpm test:e2e` | First full run: 70 passed, 4 skipped, **1 failed**: `workflow.spec.ts` reopen on mobile-360 saw the status change ~1 s after its 5 s limit (the failure screenshot shows it Reopened). The spec passed 3/3 on its own; full rerun: see §3a |

**§3a Full E2E rerun:** exit 0: **71 passed / 4 skipped / 0 failed** (5.2 min), including `notifications.spec.ts` on desktop and mobile-360.

New tests: api `test/notifications.test.ts` (13: recipients table, grouping, rollback, REST, retention, Socket.IO hub with real clients), web 12 (bell, socket handling, `?fitment=` deep link) + E2E `notifications.spec.ts` (desktop and mobile-360: the OE gets a **live toast** through the Vite Socket.IO proxy when the simulator submits, the bell keeps it after a reload, a tap opens the verification sheet), mobile 13 (provider/socket, screen, navigation).

## 4. Claude's verification and fixes
- **App routing for OEs:** the app chose the screen by type only, so an OE notified of an approval or an OM reopen was sent to the technician's fitment screen. Added `forTechnician` to the notification (worked out when read) and routed the OE to Approve visit (D-241), with API, web-fixture and mobile tests.
- **Flaky hub test:** "a bad token is refused" sometimes saw `websocket error` under full-suite load: the test connected before its ephemeral server was listening. It now waits for `listening` (passed 8/8 alone, and in every full run after).
- **Live delivery** is proven end to end by the E2E spec (real `server.ts` with the hub on the E2E API at :4100, a real browser through the Vite proxy) and by the hub integration test (real websocket client to the API port, which is how the app connects).

## 5. Not verified by Claude: check in UAT
Your Metro and servers were running, so I didn't drive the app: the bell badge, the Notifications screen, live toasts and reconnect after the app returns from the background on a device. **Restart `pnpm dev`** so the API starts the Socket.IO hub (the web dev server picks up the `/socket.io` proxy from `vite.config.ts`).

## 6. Known limitations
- No push to a closed app and no email (M20 🔜); notifications wait in the bell.
- No per-type notification settings.
- A production reverse proxy must forward WebSocket upgrades on `/socket.io`.

## 7. UAT checklist (intent acceptance criteria)

**Before you start:** pull, `pnpm install`, `pnpm --filter @champ/api db:migrate`, restart `pnpm dev` and Metro. Have an OM, an OE (managed by that OM) and a technician (managed by the OE); sign in to the app as the technician and to the web as the OE in another browser.

| # | Acceptance criterion | Manual steps | Expected |
|---|---|---|---|
| 1 | Assignment → technician | As OM on the web, assign a fitment to the technician | Within seconds the app shows a toast and the bell count; tap → the fitment |
| 2 | Submission → OE | Technician submits (or the dev simulator) | The OE's web bell and toast; tap → the task with the verification sheet open; in the app (OE) tap → Approve visit |
| 3 | Verify / approve / reopen | OE verifies; OM final-approves; OM reopens another with a reason | OM notified of the verify; technician and OE of the approval; technician and OE of the reopen, with the reason |
| 4 | Moved to FT | Technician marks one faulty | The OE is notified with the replacement TK id |
| 5 | Grouping | CSV bulk fill + *Submit ready* for 3+ fitments of one task | The OE gets one "N fitments of OM-… submitted by …" |
| 6 | Mark all read; never yourself | *Mark all as read*; do an action yourself | Count clears; no notification for your own action |
| 7 | Offline catch-up | Close the app, make it notified, reopen | The notification is in the bell |
| 8 | Web, Android, iOS; tests | Repeat 1–2 on the other platform | Works; §3 green |
