# F01 — Conversation Log

## 2026-10-11
- Claude drafted `intent.md` and sent it to the user for sign-off.
- Open points: company domain (assumed `intellicar.in`) and password policy.
- User replied "Approved". The intent is signed off, and the open points are accepted as proposed (domain `intellicar.in`, password rule). Created branch `feature/F01-foundation-auth`.

## 2026-10-11 — Implementation (impl agent)
- **Built:**
  - pnpm monorepo (`apps/api`, `apps/web`, `packages/shared`) with root scripts and docker compose (Postgres 16, MinIO).
  - API: Express 5 + Prisma 7. Covers auth (password, Google, refresh rotation with reuse detection, logout, rate limit), invites (one-time hashed links, 72 h), users (scope, edit, delegation, manager candidates), health and config.
  - Web: React + shadcn/ui console. Covers login, accept invite, dashboard, users/invites, profile, and a responsive shell.
  - README quick start and `test-report.md`.
- **Tests:** shared 41, API 103, web 8, all passing. Playwright 3 passed, 1 skipped by design (desktop + 360 px). Typecheck, lint and build are clean. The definition of done was verified from a clean clone with empty Docker volumes.
- **Issues and resolutions:**
  - Docker Desktop had stopped mid-session. Restarted it.
  - `minio/minio` image no longer exists on Docker Hub. Switched to the pinned `pgsty/minio` (D-040).
  - typescript-eslint doesn't support TS 7. Used TS 6.0 (D-039).
  - Current shadcn components need React 19 for refs. Used React 19 (D-038).
  - The shadcn CLI wrote `import { cn } from "cn"` and added `next-themes`. Fixed the imports to `@/lib/utils` and removed both packages.
  - At 360 px, long emails widened the grid tracks and clipped the page. Fixed with `grid-cols-1` (minmax(0, 1fr)) on grid containers. The E2E overflow check now also measures element bounds.
  - Fast-refresh lint warning: split the auth context/hooks (`lib/auth.ts`) from the provider (`components/AuthProvider.tsx`).
  - To avoid the destructive `prisma migrate reset` in tests, test and E2E databases are recreated by a guarded script (D-044).
- **Decisions added:** D-038 to D-044 (versions, MinIO image, bcryptjs, tsx runtime, spec gap rules, test databases).
- 2026-10-11: Claude independently re-ran typecheck, lint, 152 tests and E2E (all pass) and reviewed the auth, invite and user services. Handed to the user for UAT.
