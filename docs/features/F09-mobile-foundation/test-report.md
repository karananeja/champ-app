# F09 — Test Report

| | |
|---|---|
| Date | 2026-10-12 |
| Branch | `feature/F09-mobile-foundation` |
| Environment | macOS, Node 24, pnpm 10, Docker (postgres:16-alpine, MinIO), Chromium (Playwright), Xcode 26.6 with the iPhone 17 simulator (iOS), Android emulator Pixel_10_Pro |
| Result | **All gates pass**: typecheck, lint, 947 unit/integration tests, 67 E2E tests (4 skipped by design), build with bundle check, expo-doctor, JS export for both platforms, and native builds installed and smoke-tested on iOS and Android |

## 1. Agent timing (CR-06 / D-127)
The first feature built under the playbook: two agents in parallel.

| Agent | Wall time | Mac asleep (lid closed on battery) | Active time | Debugging tests |
|---|---|---|---|---|
| Backend (shared, API, web) | 78 min | 61 min | **~18 min** | ~3 min |
| Mobile (`apps/mobile`) | 83 min | 61 min | **~22 min** | ~10 min |

- macOS's power log shows "Clamshell Sleep" from 11:48 to ~12:52 IST, and both agents froze for that whole hour at the same moment. Without that pause, the feature would have taken about 22 minutes wall time instead of the ~51 F08 took.
- Claude's verification (gates, the first native builds, the fix below and the device smoke test) took about 35 minutes. The first native builds took about 10 minutes of that.

## 2. Definition of done

| Step | Result |
|---|---|
| Migration | `20261012500000_mobile_home_location` applied to the dev DB. **Additive only**: four nullable `User` columns (`homeLat`, `homeLng`, `homeAddress`, `homeUpdatedAt`) |
| New dependencies | `apps/mobile` only (Expo SDK 57.0.27, React Native 0.86.3, React 19.2.3, expo-router 57.0.25, expo-secure-store, expo-location, expo-dev-client, @maplibre/maplibre-react-native 11.5.0, react-native-svg, TanStack Query, React Hook Form; Jest 29 + jest-expo + RNTL 14). Exact versions; no `node-linker` change; no new `onlyBuiltDependencies` |
| expo-doctor | 21/21 checks passed |
| `expo export` (iOS + Android) | Exit 0; Metro resolves `@champ/shared` in the pnpm workspace |
| Native iOS build | `expo run:ios` on the iPhone 17 simulator: Build Succeeded, 0 errors (2 warnings) |
| Native Android build | `expo run:android` on the Pixel_10_Pro emulator: built and installed |

## 3. Quality gates

| Command | Result |
|---|---|
| `pnpm typecheck` | exit 0 (shared, api, web, mobile) |
| `pnpm lint` | exit 0 (kebab-case rule with the expo-router exceptions, D-151) |
| `pnpm test` | exit 0: **947 passed / 0 failed** (shared 383, api 329, web 192, mobile 43) |
| `pnpm test:e2e` | exit 0: **67 passed / 0 failed / 4 skipped** (existing desktop-only skips) |
| `pnpm build` | exit 0; "Bundle check: no dev simulator in dist" |

| Suite | Before (F08) | After |
|---|---|---|
| `packages/shared` | 376 | **383** (+7, `test/mobile.test.ts`) |
| `apps/api` | 311 | **329** (+18, `test/mobile.test.ts`; `geo.test.ts` changed for OT/OE access) |
| `apps/web` | 189 | **192** (+3, `home-location.test.tsx`) |
| `apps/mobile` | — | **43** (8 suites) |
| E2E | 67 + 4 skipped | **67 + 4 skipped** (`technicians.spec.ts` also checks "Not set") |

### 3.1 Shared (7)
`mobileDateOptions` across the IST midnight boundary (8 days, newest first); `mobileDateQuerySchema` window; home-location bounds and trimming; role constants and helpers.

### 3.2 API (18 in `mobile.test.ts`, plus `geo.test.ts`)
- **Mobile login:** OT and OE get 200 with a refresh token in the body and no cookie. SA, OM and RO get 403 `MOBILE_ROLE_NOT_ALLOWED` and no token row. A wrong password is 401 and an inactive account 403 (before the role check, D-134). The rate limit is shared with the web login (D-140).
- **Refresh:** rotation; reusing the old token fails; a user changed to OM gets 403 and only that token is revoked (D-135). **Logout:** revokes; an unknown token still returns 204.
- **Home location:** OT and OE can set it; others 403; bounds validated; shown on `/me` and technician rows.
- **`/mobile/home` and `/mobile/fitments`:**
  - IST day boundaries; only my fitments; deleted tasks excluded; every status counted; ordered by time, then TK.
  - OE `approveVisit` equals the verification queue for that day (D-138); OT gets null.
  - Dates outside the window → 400; SA, OM and RO → 403.
- **Geo:** OT allowed; RO still 403.

### 3.3 Web (3)
The home-location column and section: address, OpenStreetMap link, "Updated" date, and "Not set".

### 3.4 Mobile (43, Jest + RNTL)
- **Sign-in:** validation, the server's message verbatim, and the role refusal.
- **Session:** restored at launch, refresh on 401 (one shared refresh, retried once), and sign-out on a failed refresh.
- **Home location:** an OT can't skip, an OE can; save sends the body; a denied location permission explains itself.
- **Home:** counts, the OE-only tile, and a date change refetches.
- **Date options and formatting.**
- **Tasks:** cards and the empty state.
- **Profile:** fields, the `tel:` link, and sign out.
- **No connection** and *Retry* on Home and Tasks.
- **API base URL rules.**
- **Entry route (5, added in verification):** redirects by session state; renders nothing while loading or offline.

## 4. Verification findings (Claude)
1. **Blank screen on every cold launch (iOS and Android), fixed.**
   - **Cause:** the entry route always redirected to `/home`. While signed out, `Stack.Protected` refuses `/home`, so nothing drew.
   - **Why the tests missed it:** Fast Refresh resets the router, which hid the bug in development, and Jest mocks the router.
   - **Fix:** the entry route now redirects by session (D-153), with a regression test that fails without the fix (4 of 5 fail) and passes with it.
2. **Native smoke test on the Android emulator** after the fix, with a throwaway OT created through the seeded SA and then deactivated:
   - Sign in → home-location screen. The MapLibre OSM map renders and the pin's address fills in.
   - *Save* → Home (Today chip, bell, *Show tasks* 0) → Profile (details, manager phone link, home location with *Change*).
   - *Sign out* → sign-in screen.
   - The iOS Simulator shows the sign-in screen on a cold launch too.
3. **Jest leak warning:** "A worker process has failed to exit gracefully". It doesn't change any result; it's a leftover timer in the mobile suite, to be tidied in F10.
4. **Generated files:** Expo CLI rewrites `apps/mobile/.gitignore` and `expo-env.d.ts` on start. They're now committed in that form (D-152), so starting Metro leaves no diff.

## 5. Known limitations
- Google sign-in on mobile is deferred (D-132).
- The bell is a placeholder until F13. *Approve visit* shows a count only; the screen comes in F12.
- The task list is read-only: no route order, map or execution until F10 (D-131).
- `tile.openstreetmap.org` is for development only. Production needs a tile provider (OSM usage policy).
- A non-debug Android build would need cleartext HTTP allowed (or HTTPS) to reach a LAN API.
- An iPhone install needs Xcode signing with your Apple ID (personal team).

## 6. UAT checklist (intent acceptance criteria)
Before you start, have three things running:
- the API: `pnpm dev`, with `docker compose up -d` already running
- Metro: `pnpm --filter @champ/mobile start`
- the **Champ Dev** app, already installed on the iPhone 17 simulator and the Pixel_10_Pro emulator; to reinstall, see README *Field app*

You'll need an OT and an OE account (invite them on the web, or use `pnpm db:seed:demo`).

| # | Acceptance criterion | Manual steps | Expected |
|---|---|---|---|
| 1 | Installs and opens on Android and iOS, light and dark | Open Champ Dev on both devices; switch the device to dark mode | Sign-in screen with the Champ brand and illustration in both modes |
| 2 | Sign in, stay signed in, sign out | Sign in as an OT. Close the app completely and reopen it. Profile → *Sign out* | Signed in after reopening; *Sign out* returns to the sign-in screen |
| 3 | SA/OM/RO refused; clear errors | Sign in as an OM, then with a wrong password, then a deactivated user, then 11 wrong attempts | "Use the Champ web console"; "Invalid email or password"; "Your account is inactive"; "Too many login attempts…" |
| 4 | Home location by GPS, search or pin; shown on web | As an OT with no home: try *Use my current location* (simulator: Features → Location), search an address, drag the map. *Save*. Then Profile → *Change*. On the web: Technicians | The OT can't continue without saving; the address follows the pin; the Technicians page shows it with a map link |
| 5 | Show tasks count and list; OE Approve visit | Assign a fitment dated today to the OT on the web; pull to refresh on Home; open Tasks. Sign in as the OE with a submitted fitment that day | The count matches; the card shows TK id, status, time, customer, site and vehicle; the OE sees *Approve visit* with its count |
| 6 | Date picker: today and 7 days back | Open the date chip | Today, Yesterday and 6 earlier dates only; picking one updates the count and the list |
| 7 | Profile fields and dialler | Open Profile; tap the manager's phone | All fields correct; the dialler opens (on a phone) |
| 8 | No connection and recovery | Stop the API; pull to refresh or reopen. Start the API; tap *Retry* | "No connection" with *Retry*; recovers |
| 9 | Automated tests pass | — | §3: all green |
