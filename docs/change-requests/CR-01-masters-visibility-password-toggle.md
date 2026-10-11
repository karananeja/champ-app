# CR-01 — Masters visible only to SA/OM; password visibility toggle

| | |
|---|---|
| Raised | 2026-10-11 by the user, during F03 UAT |
| Status | Approved (raised directly by the user) |
| Affects | F02 (masters permissions), F01 (login and accept-invite forms) |

## User request
> "Masters tab should only be visible to Super admin and OM, also password field do not have the eye toggle to check what is entered"

## Change 1 — Masters restricted to SA and OM (D-059)
- **Web:** the Masters sidebar group (the "All masters" landing page and every master page) is shown only to SA and OM. `/masters` and `/masters/:slug` are route-guarded; other roles are redirected to `/` with a "You don't have access to that page" toast.
- **API:** `GET /masters/lookup/:kind`, `/masters/activities`, `/masters/make-models` and `/masters/locations` return 403 for OE, OT and RO. Write rules are unchanged: SA and OM edit masters; task types need SA, or OM with delegation.
- **Unchanged:** `GET /lookups` (active values for dropdowns) stays open to every signed-in user, because forms depend on it.
- This supersedes the F02 intent's "View masters: all roles" row. F02 acceptance criterion 9 ("RO sees everything") now excludes masters.

## Change 2 — Show/hide toggle on password fields
- A reusable `PasswordInput` component: the input plus an eye / eye-off icon button inside the field on the right.
  - The button is `type="button"`, with `aria-label` "Show password" / "Hide password" and `aria-pressed`.
  - It isn't a tab stop between the field and the submit button (`tabIndex={-1}` is acceptable); it is keyboard reachable otherwise.
  - Each field toggles on its own.
- Used for every password field: login, accept-invite (password and confirm), and any other field that exists.

## Acceptance criteria
1. As an OE or RO, the Masters menu isn't shown. Typing `/masters` or `/masters/final-issue` redirects to the dashboard with a message.
2. As an OE or RO, the API returns 403 for `/api/masters/*` reads. `/api/lookups` still works, and dropdowns (e.g. base location in Add technician for an OE) still populate.
3. As an OM or SA, Masters works exactly as before.
4. On the login and accept-invite pages, the eye icon reveals and hides the typed password, and the icon changes. On accept-invite, the two fields toggle independently.
5. All automated tests pass, with tests updated or added for both changes.

## Implementation and test results
Implemented on branch `cr/CR-01-masters-visibility-password-toggle` (2026-10-11).

### What changed
- **Shared:** `MASTERS_VIEW_ROLES` (`SUPER_ADMIN`, `OM`) and `canViewMasters()` in `packages/shared/src/masters.ts`. Web and API both use them.
- **API:** `mastersRouter` now runs `authenticate, requireRole(...MASTERS_VIEW_ROLES)` before every `/masters/*` route. OE, OT and RO get 403 `FORBIDDEN` on all reads (and writes, which they already couldn't do). This check runs before kind and query validation. `GET /lookups` is unchanged and open to every signed-in user. Write rules are unchanged.
- **Web:**
  - `navGroupsFor` drops the Masters group unless `canViewMasters`.
  - `/masters` and `/masters/:slug` are wrapped in `MastersRoute`. Other roles get `NoAccessRedirect`, which navigates to `/` and shows the toast "You don't have access to that page" (sonner, id `no-access`).
  - New `components/PasswordInput.tsx` adds an Eye/EyeOff (lucide) button inside the field on the right. The button has `type="button"`, `aria-label` "Show password" / "Hide password", `aria-pressed` and `tabIndex={-1}`, and clicking it keeps focus in the field. Each instance has its own state.
  - `PasswordInput` is used for the login password and for accept-invite's password and confirm fields. These are the only password fields in the app.
- **README:** the Masters paragraph now describes the SA/OM-only access.

### Test results
`pnpm typecheck` and `pnpm lint` are clean.

| Suite | Before | After |
|---|---|---|
| `packages/shared` (vitest) | 93 | **95 passed** |
| `apps/api` (vitest) | 192 | **194 passed** |
| `apps/web` (vitest) | 34 | **49 passed** |
| E2E (Playwright, desktop + mobile-360) | 16 passed, 1 skipped | **20 passed, 1 skipped** (the RO spec runs on desktop only, by design) |

New tests:
- **Shared:** `canViewMasters` is SA/OM only, and every role that can edit masters can also view them.
- **API:**
  - The permission matrix now expects 200 for SA/OM/delegated OM and 403 `FORBIDDEN` for OE/OT/RO on `/masters/lookup/accessory|task-type|final-issue`, `/masters/activities`, `/masters/make-models` and `/masters/locations`, plus 200 on `/lookups` for every role.
  - OE and RO get populated locations from `/lookups`.
  - Non-viewers get 403 even for an unknown kind or an invalid query; an OM still gets 404 for an unknown kind.
- **Web:**
  - `PasswordInput.test.tsx` (3 tests): type switch, aria-label/aria-pressed/icon change, no form submit, focus kept, not a tab stop.
  - `LoginForm.test.tsx`: one new test for the toggle on login.
  - `AcceptInvitePage.test.tsx` (new): password and confirm toggle independently.
  - `nav.test.ts` (new): Masters group shown to SA/OM only.
  - `App.test.tsx` (new, 8 tests): OE/RO/OT on `/masters` and `/masters/final-issue` are redirected to the dashboard with the toast; SA/OM open the page.
- **E2E:**
  - New `e2e/cr-01.spec.ts` (both viewports): an OE has no Masters menu, both master URLs redirect with the message, and the API returns 403 on `/api/masters/locations` and 200 on `/api/lookups`. A second test checks the login show/hide toggle.
  - `read-only.spec.ts` is extended: accept-invite toggles work independently, the RO has no Masters menu, and master URLs redirect.

### Existing tests changed, and why
- `apps/api/test/masters.test.ts`:
  - The permission matrix asserted that every role reads every master. It now expects 403 for OE/OT/RO.
  - "Activities: CRUD and filter" read as RO, and "Locations: CRUD and filters" read as OE. Both now read as SA, because those roles can't read masters any more.
- `apps/web/src/features/masters/MasterTable.test.tsx`:
  - The view-only test used an RO, who can't reach masters now. It uses a generic non-editor actor instead (the view-only mode still applies to an OM without task-type delegation).
  - The filter test now uses an OM instead of an RO.
- `apps/web/e2e/helpers.ts`: `login()` now uses `getByLabel('Password', { exact: true })`. The toggle's "Show password" label would otherwise also match.

### Manual UAT checklist
1. [ ] Sign in as an OE, then as an RO. There is no Masters group or "All masters" link (desktop sidebar and mobile menu). Typing `/masters` and `/masters/final-issue` lands on the dashboard with "You don't have access to that page".
2. [ ] As an OE, open Technicians → Add technician. The Base location dropdown is populated. In DevTools, `/api/masters/locations` returns 403 for the OE, and `/api/lookups` returns 200.
3. [ ] As an OM and as the SA, open Masters → any master. Listing, add, edit and deactivate work as before. Task types are still view-only for an OM without delegation.
4. [ ] On the login page, type a password and click the eye. The text shows and the icon changes to eye-off; click again to hide it. On an accept-invite link, the Password and Confirm password eyes toggle independently.
5. [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm test:e2e` all pass.
