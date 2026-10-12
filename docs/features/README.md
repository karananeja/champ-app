# Feature Breakdown and Build Order

Each feature gets its own folder: `docs/features/FNN-name/` with `intent.md`, `spec.md`, `conversation-log.md`, `test-report.md` and `signoff.md`.
A feature is **Complete** only after it has been implemented, tested and signed off by the user (UAT).

| ID | Feature | Depends on | Status |
|---|---|---|---|
| F01 | Platform foundation + authentication and invites | — | ✅ Complete (UAT 2026-10-11) |
| F02 | Master data and technician management | F01 | ✅ Complete (UAT 2026-10-11) |
| F03 | Client onboarding with map | F02 | ✅ Complete (UAT 2026-10-11) |
| F04 | Task creation (form, CSV bulk, auto-split) and task table views | F03 | ✅ Complete (UAT 2026-10-12) |
| F05 | Workflow engine: statuses, approvals, edit locks, reopen, FT replacement, audit/history tab | F04 | ✅ Complete (UAT 2026-10-12) |
| F06 | OE verification screen (web) and image correction | F05 | ✅ Complete (UAT 2026-10-12) |
| F07 | OM kanban board | F05 | ✅ Complete (UAT 2026-10-12) |
| F08 | Travel tasks | F05 | ✅ Complete (UAT 2026-10-12) |
| F09 | Mobile app foundation: login, home, header, profile, home location | F01 | ✅ Complete (UAT 2026-10-12) |
| F10 | Mobile route planning and starting a fitment (route, GPS start, close, FT) | F05, F09 | Awaiting UAT |
| F10B | Mobile fitment form and submit (photos, checks, scan, summary) | F10 | Not started |
| F11 | Mobile CSV bulk fill | F10 | Not started |
| F12 | Mobile history timeline, distance, Approve visit | F10 | Not started |
| F13 | In-app notifications (web and mobile) | F05 | Not started |
| F14 | Global search | F04 | Not started |
| F15 | Reports (billing) and analytics | F06 | Not started |
