# F02 — Conversation Log

## 2026-10-11
- F01 accepted and merged to main.
- Claude drafted `intent.md` and sent it to the user for sign-off. Open points: activity-to-list mapping, technician base location.
- User replied "approved". The open points are accepted as proposed (D-045, D-046). Created branch `feature/F02-master-data`.

## 2026-10-11 — Implementation (impl agent)
- Implemented the spec on `feature/F02-master-data`: Prisma models and the additive migration `20261011160132_master_data`, idempotent master seed plus `pnpm db:seed:demo`, `/lookups`, `/masters/*` and `/technicians` APIs, shared permission helpers and schemas. On the web: config-driven `MasterTable`/`MasterFormDialog` for all 16 masters, the Masters landing page and sidebar group, the Technicians page and dialog (reusing F01's one-time link view), OT fields in the Invite dialog, and name/phone prefill on the accept page.
- As the spec requires, F01 OT invites now need `technicianType` and `baseLocationId`. The F01 invite tests (API and InviteDialog) were updated accordingly.
- Decisions not covered by the spec were recorded as D-048 (technician profile edge rules), D-049 (master-data details) and D-050 (web/E2E additions).
- E2E at 360 px exposed two layout issues, both fixed: long emails widened tables, and sonner's mobile toaster overflowed by 16 px. The `navigate` helper now waits for closing dialogs before it opens the mobile menu.
- Verified on the dev DB: the migration applied on top of F01 data with both existing users kept, and the seed was run twice with the same counts. Under `pnpm dev`, `/api/health` and an authenticated `/api/lookups` as the SA both return 200. Gates: typecheck, lint and build pass; 238 unit/integration tests and 12 E2E tests pass (1 skipped by design). See `test-report.md`.
- Ready for UAT.
- 2026-10-11: Claude independently re-ran typecheck, lint, 238 tests and E2E (12 passed, 1 skipped by design), and reviewed the masters and technicians permission code. Moved toasts to the bottom so they no longer cover the mobile menu button (D-051); E2E re-run passes. Handed to the user for UAT.
- 2026-10-11: The user accepted F02 in UAT ("F02 accepted"). Feature complete; merged to main.
