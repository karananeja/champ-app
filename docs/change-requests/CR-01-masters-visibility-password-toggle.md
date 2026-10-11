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
