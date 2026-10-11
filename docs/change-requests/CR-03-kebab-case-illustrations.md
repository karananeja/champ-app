# CR-03 — Kebab-case file names, illustrations and UI polish

| | |
|---|---|
| Raised | 2026-10-12 by the user, while F05 was being built |
| Status | Approved (raised directly by the user; style choices answered by the user). In implementation together with CR-04 on branch `cr/CR-03-04-ui-refresh` |
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
