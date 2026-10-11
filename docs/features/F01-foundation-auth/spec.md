# F01 — Technical Spec

Implements `intent.md` (approved 2026-10-11). Binding decisions: see `docs/decision-log.md`.

## 1. Repository layout

```
champ/
  package.json                 # root: private, scripts dev/build/test/lint/db:*
  pnpm-workspace.yaml          # apps/*, packages/*
  tsconfig.base.json
  docker-compose.yml           # postgres:16 (5432), minio (9000/9001)
  .env.example
  apps/
    api/                       # Express + Prisma
    web/                       # React + Vite + shadcn/ui + Tailwind
  packages/
    shared/                    # zod schemas, enums, types (consumed as TS source via workspace)
```

Root scripts: `pnpm dev` (api + web in parallel), `pnpm test`, `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm db:reset`.

## 2. Shared package (`@champ/shared`)
- `Role` enum: `SUPER_ADMIN | OM | OE | OT | RO`.
- `INVITABLE_ROLES: Record<Role, Role[]>`: SA → all; OM → [OE, OT, RO]; OE → [OT]; OT, RO → [].
- Manager rules: OT's manager must be an OE; OE's manager must be an OM; OM, SA and RO have no manager (optional for RO).
- `passwordSchema`: min 8 characters, at least one letter and at least one number.
- zod schemas for every request body listed below, plus the response DTO types.

## 3. Data model (Prisma)

```prisma
enum Role { SUPER_ADMIN OM OE OT RO }
enum UserStatus { ACTIVE INACTIVE }
enum AuthProvider { PASSWORD GOOGLE }

model User {
  id            String   @id @default(cuid())
  email         String   @unique          // stored lowercased
  name          String
  phone         String?
  jobTitle      String?
  role          Role
  status        UserStatus @default(ACTIVE)
  passwordHash  String?
  authProvider  AuthProvider @default(PASSWORD)
  managerId     String?
  manager       User?    @relation("Reports", fields: [managerId], references: [id])
  reportees     User[]   @relation("Reports")
  canManageUsers     Boolean @default(false)   // delegation flag (OM only)
  canManageTaskTypes Boolean @default(false)   // delegation flag (OM only, used in F02)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  invitesSent   Invite[] @relation("InvitedBy")
  refreshTokens RefreshToken[]
}

model Invite {
  id          String   @id @default(cuid())
  email       String
  role        Role
  managerId   String?
  jobTitle    String?
  tokenHash   String   @unique    // sha256 of the random token; raw token never stored
  expiresAt   DateTime            // now + 72h
  usedAt      DateTime?
  revokedAt   DateTime?
  invitedById String
  invitedBy   User     @relation("InvitedBy", fields: [invitedById], references: [id])
  createdAt   DateTime @default(now())
}

model RefreshToken {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash String   @unique
  expiresAt DateTime
  revokedAt DateTime?
  createdAt DateTime @default(now())
}
```

Seed: one SA from env `SEED_SUPERADMIN_EMAIL` / `SEED_SUPERADMIN_PASSWORD` (defaults `admin@intellicar.in` / `Admin@1234`). Idempotent.

## 4. Auth design
- Access token: JWT HS256, 15 min, payload `{ sub, role }`, sent as `Authorization: Bearer`.
- Refresh token: random 32 bytes, stored hashed, valid 7 days, rotated on every refresh. Sent and stored in an httpOnly `SameSite=Lax` cookie `champ_rt` (path `/api/auth`). Reuse of a revoked token revokes all of that user's tokens.
- The web app keeps the access token in memory and calls `/auth/refresh` on load and on a 401 (single-flight).
- Google: the web app uses Google Identity Services (button) to get an ID token and posts it to `/auth/google`. The API verifies it with `google-auth-library` against `GOOGLE_CLIENT_ID`. It requires `email_verified` and `hd === GOOGLE_ALLOWED_DOMAIN` (default `intellicar.in`). Login only succeeds if an ACTIVE user with that email exists. `GET /api/config` returns `{ googleClientId: string | null }` so the UI can hide the button.
- Inactive users cannot log in or refresh.
- Passwords are hashed with bcrypt (cost 12).
- Login is rate limited (`express-rate-limit`, 10 per 15 min per IP + email).

## 5. API (prefix `/api`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | — | `{ ok: true }` + db check |
| GET | `/config` | — | `{ googleClientId }` |
| POST | `/auth/login` | — | `{ email, password }` → `{ accessToken, user }` + sets cookie |
| POST | `/auth/google` | — | `{ idToken }` → same as login |
| POST | `/auth/refresh` | cookie | → `{ accessToken, user }`, rotates cookie |
| POST | `/auth/logout` | cookie | revokes the refresh token, clears cookie |
| GET | `/me` | user | current user with manager `{ name, phone }` |
| POST | `/invites` | SA/OM/OE (+rules) | `{ email, role, managerId?, jobTitle? }` → `{ invite, link }`. The link (`${WEB_URL}/accept-invite?token=…`) is returned **only in this response** |
| GET | `/invites` | SA/OM/OE | invites sent by me (SA: all); status derived: PENDING/USED/EXPIRED/REVOKED |
| POST | `/invites/:id/revoke` | inviter or SA | |
| GET | `/invites/lookup?token=` | — | `{ email, role, inviterName }` if valid, otherwise 410 with code `INVITE_EXPIRED`, `INVITE_USED` or `INVITE_INVALID` |
| POST | `/invites/accept` | — | `{ token, name, phone, password }` → creates the user, marks the invite used, logs in |
| POST | `/invites/accept/google` | — | `{ token, idToken }`. The Google email must equal the invite email |
| GET | `/users` | SA, OM, OE, RO | query `role, status, q, page, pageSize`. Scope: SA, OM and RO see all; OE sees self and own reportees |
| GET | `/users/:id` | same scope | |
| PATCH | `/users/:id` | SA, or OM with `canManageUsers` | `{ role?, managerId?, status?, name?, phone?, jobTitle? }`. An OM cannot touch SA/OM users or grant SA/OM |
| PATCH | `/users/:id/delegation` | SA only | `{ canManageUsers?, canManageTaskTypes? }`; the target must be an OM |
| GET | `/users/managers?role=OT\|OE` | inviters | candidate managers for the role |

Invite rules (enforced on the server):
- `role ∈ INVITABLE_ROLES[actor.role]`.
- The email is not already an existing user.
- No other pending invite exists for that email (a new invite revokes the old one).
- The manager is valid for the role. When an OE invites an OT, the manager defaults to and is forced to the OE.

Errors use the format `{ error: { code, message, details? } }`. zod validation failures return 400 with field details. Other statuses: 401 unauthenticated, 403 forbidden, 404, 409 conflict, 410 gone (invite).

API structure: `src/app.ts` (factory, used by tests), `src/server.ts`, `src/config/env.ts` (zod-validated env), `src/modules/{auth,invites,users,health}/{router,service}.ts`, `src/middleware/{auth,requireRole,validate,error}.ts`, `src/lib/{prisma,jwt,tokens,logger}.ts`. Logging via pino; security via helmet and cors (origin `WEB_URL`, credentials).

## 6. Web app
- Stack: React 18, Vite, TypeScript, Tailwind, shadcn/ui, React Router, TanStack Query, React Hook Form + zod (from shared), sonner toasts, lucide icons.
- The dev server proxies `/api` to the API port, so cookies are same-origin.
- Routes:
  - `/login`: email/password, plus the Google button if configured.
  - `/accept-invite?token=`: validates on load and shows a friendly error for expired, used or invalid links. Fields: name, phone, password, confirm, or "Continue with Google".
  - `/` dashboard placeholder: "Welcome, {name}" plus a role badge.
  - `/users`: table (name, email, role, manager, status) with search and filters, and an **Invite user** button (only for roles that can invite).
    - Row actions follow permissions: edit role or manager, activate/deactivate, and (SA only) delegation toggles for OMs.
    - The pending invites list is on a tab.
  - `/profile`: read-only.
- Invite dialog: email, role (only invitable roles), manager (shown when needed), job title. On success it switches to a **one-time link view** with a copy button and the warning "This link is shown only once and expires in 72 hours".
- App shell:
  - Sidebar on ≥ md. On mobile, a top bar with a hamburger that opens a sheet.
  - Menu items depend on the user's role.
  - User menu with profile and logout.
- Protected routes redirect to `/login`. A RO user sees no mutating buttons.
- Mobile responsive down to 360 px; tables collapse to cards on small screens.

## 7. Environment (`.env.example`)
```
DATABASE_URL=postgresql://champ:champ@localhost:5432/champ
JWT_ACCESS_SECRET=change-me
API_PORT=4000
WEB_URL=http://localhost:5173
GOOGLE_CLIENT_ID=
GOOGLE_ALLOWED_DOMAIN=intellicar.in
SEED_SUPERADMIN_EMAIL=admin@intellicar.in
SEED_SUPERADMIN_PASSWORD=Admin@1234
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=champ
S3_SECRET_KEY=champchamp
S3_BUCKET=champ
```

## 8. Tests
- **API** (Vitest + Supertest against a separate `champ_test` database, reset per run):
  - login success and failure
  - refresh rotation and reuse detection
  - logout
  - inactive user blocked
  - invite matrix (every actor role × target role)
  - manager rules
  - accept-invite happy path, expired, used and invalid tokens
  - duplicate email
  - user scope per role
  - OM delegation on and off
  - RO forbidden on mutations
  - Google domain rejection (verifier mocked)
- **Shared**: password schema and the invitable-roles matrix.
- **Web**: component tests for the login form validation and the invite dialog's one-time link view.
- **E2E** (Playwright): SA logs in, invites an OM, opens the link, the OM sets a password and lands on the dashboard; plus one run at a 360 px viewport.

## 9. Definition of done
- `docker compose up -d && pnpm i && pnpm db:migrate && pnpm db:seed && pnpm dev` works from a clean clone.
- `pnpm typecheck`, `pnpm lint` and `pnpm test` pass, and the E2E suite passes.
- The README has a quick start.
- `docs/features/F01-foundation-auth/test-report.md` is written.
