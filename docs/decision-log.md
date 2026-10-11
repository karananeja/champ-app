# Champ — Decision Log

Important decisions made during the project. Status values: Proposed, Accepted, Superseded.

| ID | Date | Decision | Rationale | Status | Decided by |
|---|---|---|---|---|---|
| D-001 | 2026-10-11 | Keep SDLC artifacts as Markdown in `docs/` in the project folder | Versioned with the code and easy to review | Accepted (see D-036) | User |
| D-002 | 2026-10-11 | TypeScript monorepo using pnpm workspaces: web, mobile, api, shared | Shared types and validation | Accepted | User |
| D-003 | 2026-10-11 | Backend: NestJS + PostgreSQL/PostGIS + Prisma | RBAC guards, geo queries | Superseded by D-007 | — |
| D-004 | 2026-10-11 | Web: React + Vite + shadcn/ui + Tailwind; Mobile: React Native | User choice; requirements doc specifies React / React Native | Accepted (Expo, see D-035) | User |
| D-005 | 2026-10-11 | Maps and routing: OSM tiles, OSRM, Nominatim | Requirements specify OpenStreetMap | Accepted (see D-020) | User |
| D-006 | 2026-10-11 | MVP runs locally via Docker Compose; invite links shown in a one-time copy dialog | Per the requirements doc NOTE | Accepted (from requirements) | User |
| D-007 | 2026-10-11 | Backend: Node.js + Express + PostgreSQL + Prisma | User choice | Accepted | User |
| D-008 | 2026-10-11 | Mobile MVP is online-only; offline sync is deferred to production | Lower MVP complexity | Accepted | User |
| D-009 | 2026-10-11 | Creating a task with N vehicles auto-generates N technician tasks; the OE can assign each one to any technician | One fitment = one independent unit, which allows per-device FT moves | Accepted | User |
| D-010 | 2026-10-11 | Mobile MVP targets Android and iOS | User choice | Accepted | User |
| D-011 | 2026-10-11 | Task status flow: Open → Assigned → In progress → Submitted (OT) → OE verified → OM approved, with side paths Closed – not done, Moved to FT, Reopened. These statuses also drive the OM kanban columns and the history stages | Confirms Q-T3 | Accepted | User |
| D-012 | 2026-10-11 | Moving a fitment to FT auto-creates a replacement fitment task, which the OE handles and reassigns | Q-T6 | Accepted | User |
| D-013 | 2026-10-11 | SA-created task types are a name only (no custom form builder) in MVP | Q-T4 | Accepted | User |
| D-014 | 2026-10-11 | Mobile "Approve visit" = the OE approves a fitment task the OT has completed and submitted (Submitted → OE verified) | Q-M7 | Accepted | User |
| D-015 | 2026-10-11 | The system computes the best and most economical route order (OSRM trip); the OT follows the system order. Daily distance = routed distance from task 1 to task n of completed tasks | Q-M3/Q-M4 | Accepted | User |
| D-016 | 2026-10-11 | Google SSO restricted to the company domain. Third-party and contractual technicians log in with email/password | Q-A1/Q-A2 | Accepted | User |
| D-017 | 2026-10-11 | Hard-coded lists use dummy values, stored as editable master data; the user will provide real values later | Q-T7 | Accepted | User |
| D-018 | 2026-10-11 | Billing = simple monthly per-client report of billable activities. Travel reimbursement is calculated outside the system; TT only records and verifies travel | Q-B1/Q-B2 | Accepted | User |
| D-019 | 2026-10-11 | No integration with other Intellicar systems | Q-I1 | Accepted | User |
| D-020 | 2026-10-11 | Use public OSM services (tiles, OSRM, Nominatim) for the MVP | Q-I2 | Accepted | User |
| D-021 | 2026-10-11 | Mobile CSV bulk fill: the OT uploads a CSV of task details, the system pre-fills the fitment forms, and the OT confirms before submitting | Q-M6 | Accepted | User |
| D-022 | 2026-10-11 | Device type is a master-data option with the single value "LAF5" | User comment on Q-M5 | Accepted | User |
| D-023 | 2026-10-11 | Device ID / Secondary device ID scan supports both barcode/QR and OCR text recognition | Q-M5 not answered; default applied | Accepted (default) | User |
| D-024 | 2026-10-11 | Reporting hierarchy: each OT → one OE → one OM | Q-A3 default | Accepted (default) | User |
| D-025 | 2026-10-11 | Read-only users are invited by SA/OM and can see everything except the OM-only history/raw-data tab | Q-A4 default | Accepted (default) | User |
| D-026 | 2026-10-11 | Invite links are single use and expire after 72 h | Q-A5 default | Accepted (default) | User |
| D-027 | 2026-10-11 | OE or OM can reopen a task until OM approval; a reason is required; reopen counts per OT/OE appear in analytics | Q-T5 default | Accepted (default) | User |
| D-028 | 2026-10-11 | Per-activity checks are the same for all activities (OK / Not OK / NA); cluster and CAN checks are hidden for Battery assets | Q-T8 default | Accepted (default) | User |
| D-029 | 2026-10-11 | Technicians can work on tasks dated up to 7 days in the past | Q-M8 default | Accepted (default) | User |
| D-030 | 2026-10-11 | Analytics KPIs: tasks by status, turnaround time, reopen rate, fitments per OT per day, faulty rate, km travelled | Q-B3 default | Accepted (default) | User |
| D-031 | 2026-10-11 | Photos are stored in MinIO (S3 API), compressed on the device and stamped with timestamp and GPS | Q-I3 default | Accepted (default) | User |
| D-032 | 2026-10-11 | The OE adds the external debug image as an image file upload | Q-I6 default | Accepted (default) | User |
| D-033 | 2026-10-11 | Raw data tab = the full event/audit log of the task (actor, time, before/after values) | Q-I7 default | Accepted (default) | User |
| D-034 | 2026-10-11 | Google OAuth client ID comes from an env var; Google sign-in is hidden in the UI until it is configured | Q-A1 default | Accepted (default) | User |
| D-035 | 2026-10-11 | React Native via Expo (development build) | Default | Accepted (default) | User |
| D-036 | 2026-10-11 | Docs as Markdown in `docs/`; git repo with one branch per feature; an "approved" reply in chat counts as sign-off and is recorded in the feature folder | Q-P1–P3 defaults | Accepted (default) | User |
| D-037 | 2026-10-11 | Google SSO domain = intellicar.in; password rule: min 8 chars, ≥1 letter, ≥1 number | F01 intent sign-off | Accepted | User |
| D-038 | 2026-10-11 | Web uses React 19 instead of React 18 (spec §6) | Current shadcn/ui components pass refs as props (no `forwardRef`), which only works in React 19. With React 18, Radix `asChild` triggers lose their refs | Accepted | Impl agent (F01) |
| D-039 | 2026-10-11 | Toolchain versions: TypeScript 6.0 (not 7.x), Prisma 7.10 (8.0 is still RC) with `prisma.config.ts`, the `prisma-client` generator and `@prisma/adapter-pg`; Express 5, Vite 8, Vitest 5, Tailwind 4, ESLint 10 | typescript-eslint supports TS < 6.1. Use the latest stable versions otherwise | Accepted | Impl agent (F01) |
| D-040 | 2026-10-11 | MinIO image is `pgsty/minio` (pinned release) instead of `minio/minio` | `minio/minio` is no longer published on Docker Hub. pgsty/minio is a maintained drop-in build (same entrypoint, S3 API and console) | Accepted | Impl agent (F01) |
| D-041 | 2026-10-11 | Password hashing uses `bcryptjs` (bcrypt algorithm, cost 12) instead of the native `bcrypt` package | Same hash format, no native build step. pnpm 10 blocks dependency build scripts by default | Accepted | Impl agent (F01) |
| D-042 | 2026-10-11 | The API runs from TypeScript via `tsx` (dev and `pnpm start`). `pnpm build` type-checks the API and builds the web app | `@champ/shared` is consumed as TS source (spec §1). A compiled API bundle isn't needed for the local MVP (D-006) | Accepted | Impl agent (F01) |
| D-043 | 2026-10-11 | F01 rules the spec left open: (1) an RO's manager is optional but, if set, must be an active OM; (2) when an OM invites an OE without a manager, it defaults to that OM; (3) users cannot change their own role or status; (4) a role change is refused (409) while the user has reportees; (5) deactivation revokes all refresh tokens; (6) `GET /users/managers` also accepts `role=RO`; (7) `GET /invites` returns `{ items }`; (8) web refreshes are serialized across tabs with the Web Locks API, so reuse detection doesn't log out a second tab | These fill gaps in the spec, and protect against lockout and orphaned hierarchies | Accepted | Impl agent (F01) |
| D-044 | 2026-10-11 | Tests use separate databases: `champ_test` (API tests) and `champ_e2e` (Playwright, API :4100 / web :5174). Both are created if missing, then dropped and re-migrated on each run by `apps/api/scripts/prepare-db.ts`. The script only works on `*_test` / `*_e2e` databases | Isolation from dev data; repeatable runs; E2E can run alongside `pnpm dev` | Accepted | Impl agent (F01) |
