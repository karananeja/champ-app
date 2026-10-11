# F01 — Platform Foundation + Authentication and Invites: Intent

| | |
|---|---|
| Status | **Approved by user on 2026-10-11** |
| Requirements | SRS §2, §3, §6.1 · Decisions D-002, D-004, D-006, D-007, D-016, D-024–D-026, D-034, D-036 |

## Why
Every later feature needs a working monorepo, database, API and web shell, plus authenticated users with roles. This feature delivers the base that the rest is built on, and is the first thing you can test end to end.

## What will be built

**Foundation**
- A pnpm monorepo: `apps/api` (Express + Prisma), `apps/web` (React + Vite + shadcn/ui + Tailwind) and `packages/shared` (zod schemas, role enums, types). `apps/mobile` is only scaffolded later, in F09.
- Docker Compose for PostgreSQL and MinIO, a `.env.example`, and `pnpm dev` to run everything.
- Prisma schema for User, Invite and RefreshToken, plus a seed script that creates one Super Admin.
- Shared conventions: error format, request validation, logging, and test setup (Vitest + Supertest, Playwright smoke test).

**Authentication**
- Sign in with email and password, with JWT access and refresh tokens and logout.
- Google sign-in, restricted to the company domain. It's hidden unless `GOOGLE_CLIENT_ID` is set.
- Server-side role-based access for SA, OM, OE, OT and RO.

**Invites and users**
- Invite user (email, role, manager):
  - SA can invite any role; OM can invite OE, OT and RO; OE can invite OT.
  - The link is shown once in a copy dialog. It is single use and expires after 72 hours.
- Accept-invite page: set name, phone and password, or continue with Google.
- Users page:
  - SA sees all users; OM and OE see users they can invite.
  - Actions: activate/deactivate, change role or manager (SA, or OM with delegated permission).
- SA can toggle "delegate user management" and "delegate task types" for each OM. The task-type side takes effect in F02.
- Read-only profile page.
- Responsive app shell: sidebar or bottom navigation on mobile, with role-aware menu items.

## Out of scope for F01
Master data, technician-specific fields such as home location (F02 and F09), the mobile app (F09), email delivery and password reset by email.

## Acceptance criteria (UAT)
1. `docker compose up` followed by `pnpm dev` starts the API and web app locally.
2. The seeded SA can log in. Wrong credentials show an error.
3. SA invites an OM and gets a copyable link shown once. Opening it in another tab lets the OM set a password and log in.
4. The OM can invite an OE but cannot invite an SA. The OE can invite only OT.
5. An expired or already-used invite link shows a clear error.
6. A RO user can log in and sees no create, edit or invite actions.
7. Google sign-in is hidden when not configured. When configured, it rejects emails outside the company domain.
8. The layout works at 360 px width.
9. Automated tests pass for auth, invites and role rules.

## Open points for this feature
- **Company domain** for Google sign-in: I'll assume `intellicar.in` unless you say otherwise.
- **Password policy**: minimum 8 characters, including at least one letter and one number. OK?
