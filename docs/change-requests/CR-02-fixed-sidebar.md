# CR-02 — Sidebar stays fixed while page content scrolls

| | |
|---|---|
| Raised | 2026-10-12 by the user, during F04 UAT |
| Status | ✅ Complete: accepted by the user on 2026-10-12 ("CR-02 accepted") |
| Affects | F01 app shell (`apps/web/src/components/layout/AppShell.tsx`) |

## User request
> "the side bar should not scroll with the left side body when the content grows in height"

## Change (D-072)
- From `md` width up, the sidebar is `sticky top-0` with full viewport height (`h-svh`, `self-start`). It stays in place while the page scrolls.
- If the menu itself is taller than the screen, the sidebar scrolls on its own (`overflow-y-auto`).
- Phones are unchanged: the menu is the hamburger sheet.
- Implemented directly by Claude as a one-line layout change; it didn't need a separate implementation agent.

## Acceptance criteria
1. On a desktop-width window, on a long page (e.g. Open tasks with many rows, or a task's detail page), scroll down: the sidebar and its links stay visible and in place.
2. Phone width is unchanged (hamburger menu).

## Test results (2026-10-12)
- New E2E `apps/web/e2e/cr-02.spec.ts` (desktop): makes the page 4000 px tall, scrolls to the bottom, and asserts the sidebar is still at y=0, full viewport height, with its links in view. **Verified to fail without the fix and pass with it.**
- `pnpm lint` and web unit tests (74) pass. Full E2E: 29 passed, 2 skipped (desktop-only specs on the mobile project).
