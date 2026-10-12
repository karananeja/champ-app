# CR-03 — Kebab-case file names, illustrations and UI polish

| | |
|---|---|
| Raised | 2026-10-12 by the user, while F05 was being built |
| Status | Implemented, awaiting user acceptance |
| Affects | All apps (file names); web UI (illustrations, polish) |

## User request
> "file naming convention should be kebab case and use illustrations to show error, empty screens and more so that the ui looks better and not so simple as it is currently"

User choices (2026-10-12):
- Illustration style: **unDraw-style**.
- Scope: **illustrations + polish**.
- Brand colour: **Claude to pick**.

## Change 1 — Kebab-case file names
- Every source, test and E2E file in `apps/api`, `apps/web` and `packages/shared` is renamed to kebab-case, e.g. `AppShell.tsx` → `app-shell.tsx` and `MasterTable.test.tsx` → `master-table.test.tsx`.
- Exported component, type and function names keep their usual casing (PascalCase components).
- Exempt: generated code (`src/generated/**`), Prisma migration folders, config files whose names tools expect (`vite.config.ts`, `prisma.config.ts`, `eslint.config.js`, etc.), and `README.md`.
- shadcn `components/ui/*` are already kebab-case.
- Use `git mv` so history is kept, and update every import.
- **Enforced** by an ESLint rule (`eslint-plugin-check-file` or `unicorn/filename-case` with kebab-case), so new files can't break the convention. Document it in the README "Conventions" section.
- Recorded as decision: kebab-case file names.

## Change 2 — Illustrations (unDraw-style)
- Flat SVG illustrations in the unDraw style (open licence, no attribution required), **bundled locally** (no runtime CDN). Recolour them to the brand primary through `currentColor` or a CSS variable, so they follow the theme.
- A reusable `<EmptyState illustration title description action?>` component and a `<ErrorState>` variant.
- Used for:
  - every list with no data, and lists with no search or filter matches
  - 404 Not found
  - 403 "You don't have access" (CR-01 currently uses a redirect and a toast; keep the redirect for masters, but add a proper 403 page for direct URLs where a redirect isn't used)
  - generic error and error boundary (500)
  - network or offline error
  - invite invalid, expired or used
  - the login and accept-invite pages (split screen with an illustration on desktop, illustration above the form on mobile)
  - dashboard welcome
  - the F04/F05 placeholder pages (Travel)
- Illustrations are decorative (`aria-hidden`) with real text alongside. They're sized for 360 px and lazy-loaded where large.

## Change 3 — UI polish
- **Brand colour (Claude's pick):** indigo primary (around `oklch(0.51 0.23 277)`, Tailwind indigo-600), tuned for WCAG AA contrast in light and dark mode. Defined once in the theme tokens, so changing it later means editing one place.
- **Page headers:** title, short description, icon, and primary action on the right (stacked on mobile).
- **Dashboard:** role-aware stat cards. Examples:
  - OM/SA: open tasks, awaiting approval, reopened, faulty.
  - OE: my assigned tasks, submitted awaiting verification.
  - RO: open tasks.
  - Each card links to its list.
- **Loading skeletons** instead of spinners for tables, cards and detail pages.
- **Sidebar:** active-item accent and section dividers. Consistent status badge colours.
- No change to behaviour or permissions.

## Acceptance criteria
1. No source file in the three packages uses PascalCase or camelCase names (except the listed exemptions). Lint fails if a new non-kebab file is added.
2. Every empty list, no-results state, 404, 403, error and invite-error screen shows an illustration with a clear message and, where useful, an action button.
3. Login and accept-invite use the split-screen illustration layout on desktop and a stacked layout on mobile.
4. The app uses the new brand colour consistently, in light and dark mode.
5. The dashboard shows role-aware stat cards that link to the matching lists.
6. Lists and detail pages show skeletons while loading.
7. Everything works at 360 px. All automated tests pass.

## Implementation and test results

Branch `cr/CR-03-04-ui-refresh`, commits `548b68b` (kebab-case rename, pure renames + lint rule) and `6c22d1d` (illustrations and polish). Decisions D-089 to D-097, mainly D-090, D-092, D-093, D-094 and D-096.

### Changes
- **Kebab-case**: 68 files in `apps/api`, `apps/web` and `packages/shared` were renamed with `git mv` (via a temp name where only the case changed), and every import was updated. Exported names keep their casing. Exempt: generated code, Prisma migrations, tool config files and README. **Enforced** by `eslint-plugin-check-file` (file and folder names, D-093). The README has a new "Conventions" section.
- **Illustrations** (D-094):
  - 13 real unDraw SVGs (undraw.co, free without attribution), bundled in `apps/web/src/assets/illustrations`. They load as lazy chunks, are inlined, `aria-hidden`, and are recoloured to the theme primary, with dark-mode inks.
  - `EmptyState`, `ErrorState` (offline/network, 403, 404, generic, with retry) and `ListStates` (skeleton, error, empty, "no matches" with Clear filters).
  - Used on: Users, Invites, Technicians, Clients, every master, Open/Assigned/Completed/All tasks, Awaiting approval, Re-opened, Faulty, history events, task/client detail and edit pages, the dashboard welcome, and the Travel placeholder.
- **Pages** (D-090):
  - 404 for unknown URLs inside the app.
  - 403 for Users/Technicians/Clients guards. Masters and task guards keep the CR-01 redirect with a toast.
  - Error boundary page; offline banner.
  - Login and accept-invite are split screen on desktop, with the illustration above the form on phones. Invalid, expired and used invites show the invite-error illustration.
- **Brand** (D-086): indigo primary defined once in `index.css`. Light: indigo-600 with white text, 7:1. Dark: indigo-400 with indigo-950 text, 5.3:1. Dark mode now follows the OS setting; toasts follow it too. The favicon is indigo.
- **Polish**:
  - `PageHeader` (title, description, icon, actions; stacked on phones) on list pages.
  - Sidebar active accent bar and group dividers.
  - One badge tone map with dark variants (D-096).
  - Skeletons replace the old placeholder blocks on lists and on detail/edit pages.
- **Dashboard** (D-092): a welcome card with an illustration, plus role-aware stat cards that link to their lists. Counts come from the new `GET /api/tasks/summary`, which reuses each list's filter, so counts equal the list totals and keep OE scoping. OT gets no cards.
- No permission changes. The only behaviour difference: guarded Users, Technicians and Clients URLs, and unknown URLs, now show a 403 or 404 page instead of silently going to the dashboard.

### Test results
Counts for the whole branch are in the CR-04 section: shared 232, API 270, web 143, E2E 49 passed / 2 skipped. All checks pass: typecheck, lint, build.

New tests for CR-03:
- Web `kebab-case-lint.test.ts` (12): the lint rule rejects PascalCase/camelCase files and folders, and accepts kebab names, `.test`/`.spec`/`.setup`/`.d`/config files.
- `components/empty-state.test.tsx` (11): illustration inlined, decorative and recolourable; EmptyState; ErrorState variants and retry; ListStates skeleton / empty / no matches / error.
- `auth-layout.test.tsx` (split screen).
- Invite error cases (4).
- App routes: 404, five 403 cases, and the error boundary recovering on navigation.
- `dashboard-page.test.tsx` (6): cards per role, links, counts, OT, loading and error.
- API `test/tasks-summary.test.ts` (3): counts per role equal the list totals, OE scoping, deleted tasks excluded, OT 403 / 401, zeros.
- E2E `cr-03.spec.ts` (5 × 2 viewports):
  - Split screen vs stacked; brand tokens in light and dark (`--primary` and the button colour change).
  - Invalid invite page.
  - OM dashboard cards link to their lists; 404 page.
  - OE cards, illustrated empty Re-opened list, and a 403 for a client URL.
  - RO cards.

Changed tests (and why):
- `master-table.test.tsx` expects the new empty-state text ("No locations yet").
- E2E `tasks.spec.ts` expects "No tasks match" after searching for a deleted task.
- E2E `clients.spec.ts`: an OE opening a client's edit URL now sees the 403 page instead of being redirected home (D-090).
- `e2e/helpers.ts` `navigate` waits for a closing dropdown menu.
- `src/test/setup.ts` stubs `matchMedia` (the toaster's system theme).

### Manual UAT checklist
1. [ ] In `apps/*` and `packages/shared`, file names are kebab-case. Create `apps/web/src/components/MyThing.tsx`: `pnpm lint` fails. Delete it.
2. [ ] Empty lists show an illustration with a clear message and, where useful, an action. For example: Re-opened as an OE with no reopens, or a master filtered to nothing ("No matches" + Clear filters).
3. [ ] Open `/does-not-exist`: the 404 page. As an OE, open `/clients/new`: the 403 page. As an OE, open `/masters`: still redirected with a toast (CR-01).
4. [ ] Stop the API (or go offline): lists show the offline state and the banner appears. Errors show "Something went wrong" with Try again.
5. [ ] Open an invite link twice, an expired one, and `/accept-invite?token=x`: each shows the invite-error illustration and the reason.
6. [ ] Login and accept-invite: split screen on a wide window; illustration above the form on a phone.
7. [ ] The indigo brand is used for buttons, links, focus rings, the active sidebar item and illustrations. Switch the OS to dark mode: everything stays readable.
8. [ ] Dashboard: SA/OM see Open, Awaiting approval, Re-opened, Faulty and Completed; OE sees My tasks, To verify, Open, Re-opened and Faulty; RO sees Open and Completed. Each card opens its list, and the count matches the list total.
9. [ ] Lists and detail pages show skeletons while loading. Throttle the network in dev tools to see them.
10. [ ] Everything works at 360 px.
