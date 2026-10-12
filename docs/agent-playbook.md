# Implementation-agent playbook

How Claude briefs and runs implementation agents (CR-06, D-127). Target: **≈ 20 min wall time per agent**.

## 1. Sizing and split
- **Single agent** for CRs and small features (expected < ~1,500 changed lines, or one layer only).
- **Two parallel agents** for a feature that touches both API and web:
  1. **Backend agent** (`packages/shared`, `apps/api`): first commits the shared contracts (enums, schemas, DTOs,
     rule functions and their tests) and reports "contracts committed". Then it builds the migration, API and API tests.
  2. **Frontend agent** (`apps/web`, `apps/web/e2e`): launched as soon as the contracts are committed. It builds the
     UI and web tests against the spec and the shared types. It writes and runs E2E once the backend agent reports
     its API done (Claude relays the message).
  - Each agent owns its directories, edits nothing outside them and commits only its own paths (`git add <paths>`,
    never `git add -A`). Shared changes the frontend needs go through Claude to the backend agent.
  - The decision log is edited only by Claude after both finish; agents put their proposed decisions in their final report.
- If a feature would still need more than ~20 min per agent, split it into smaller features at the intent stage.

## 2. Brief contents
- Hard rules (branch, no impersonation, no `git stash`, no `rm -rf`, leave dev servers on 3000/4000 alone, kebab-case).
- The exact files to read (spec, intent, the 3–5 closest existing modules by path), not "study the code".
- The time box and the test loop below.

## 3. Test loop
- While iterating: `pnpm --filter <pkg> exec vitest run <files>` for touched tests only. Use `tsc --noEmit` on the
  package, not the whole repo.
- E2E while iterating: `pnpm --filter @champ/web exec playwright test <spec> --project=desktop`, then
  `--project=mobile-360` once desktop passes. Use the helpers in `e2e/helpers.ts` (`navigate` handles the mobile
  menu, `switchUser`, `pickSearchable` and so on).
- On an E2E failure, read `test-results/**/error-context.md` (page snapshot) before changing anything. Never raise
  `test.setTimeout` above 60 s. Actions fail after 15 s (`actionTimeout`).
- Full gates **once**, at the end: `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e`.
  Re-run only what failed.

## 4. Time box
- 20 min target per agent. After **3 failed attempts at the same failure**, stop, commit the working parts and report the
  failure with its error context instead of looping.
- The final report includes the agent's wall time and the minutes spent on E2E.
