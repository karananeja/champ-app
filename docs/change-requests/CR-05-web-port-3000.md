# CR-05 — Web dev server on port 3000

| | |
|---|---|
| Raised | 2026-10-12 by the user |
| Status | In implementation: a separate commit on `feature/F07-om-kanban`, made by the F07 agent to avoid conflicting edits |
| Affects | Web dev server config, API `WEB_URL` default, `.env.example`, README, test fixtures |

## User request
> "i have added google client id, so update the fe port to 3000"

## Change
- Vite dev server port 5173 → **3000** (`strictPort: true`).
- `WEB_URL` (used for CORS and invite links) default and `.env.example` → `http://localhost:3000`.
- The user's local `.env` was updated by Claude on 2026-10-12: `WEB_URL=http://localhost:3000`. `GOOGLE_CLIENT_ID` is set and `GOOGLE_ALLOWED_DOMAIN=intellicar.in`.
- README and test fixtures updated. E2E ports (4100/5174) are unchanged.

## Acceptance criteria
1. `pnpm dev` serves the web app on http://localhost:3000. Invite links point to port 3000.
2. "Sign in with Google" appears on the login and accept-invite pages. An `@intellicar.in` Google account with an existing Champ user signs in; other domains are refused.
3. All automated tests pass.

## Note for the user
The Google OAuth client must list `http://localhost:3000` under **Authorised JavaScript origins**. Invite links already generated with `:5173` still work if opened on `:3000` instead.
