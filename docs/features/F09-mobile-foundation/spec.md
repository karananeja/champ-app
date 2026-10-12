# F09 — Technical Spec

Implements `intent.md` (approved 2026-10-12). Binding decisions: D-008, D-010, D-014, D-029, D-035, D-078, D-084, D-127 (agent playbook) and D-128–D-133, plus everything from F01–F08 and the CRs. Follow the existing structure and conventions. Reuse:
- the auth service (`apps/api/src/modules/auth/service.ts`: password login, refresh rotation, revoke) and its login rate limiter
- the geocoder and `/geo` service
- the F06 OE verification scope (which OE may verify a submitted fitment)
- IST day helpers already in `packages/shared`

Don't duplicate them.

Built by **two parallel agents** (D-127): **Backend** owns §1–§4 and §6 (`packages/shared`, `apps/api`, the small web change in §6). **Mobile** owns §5 (`apps/mobile`, plus the root lint/workspace config it needs).

## 1. Data model (additive migration)

```prisma
model User {
  // …existing
  homeLat        Float?
  homeLng        Float?
  homeAddress    String?   // 3..300
  homeUpdatedAt  DateTime?
}
```
Set together or not at all. No backfill.

## 2. Shared contracts (`packages/shared/src/mobile.ts`, exported from `index.ts`). Backend commits these FIRST.

```ts
export const MOBILE_ROLES = ['OT', 'OE'] as const satisfies readonly Role[];          // D-128
export const HOME_LOCATION_REQUIRED_ROLES = ['OT'] as const satisfies readonly Role[]; // D-129 (OE optional)
export const MOBILE_PAST_DAYS = 7;                                                     // D-029

export interface HomeLocationDto { lat: number; lng: number; address: string; updatedAt: string }
// UserDto gains: homeLocation: HomeLocationDto | null   (null for roles other than OT/OE)

export const setHomeLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().trim().min(3).max(300),
});

export interface MobileAuthResponse extends AuthResponse { refreshToken: string }
export const mobileRefreshSchema = z.object({ refreshToken: z.string().min(1) });   // also the logout body

/** IST calendar days the app may show: today and the MOBILE_PAST_DAYS before it, newest first. */
export function mobileDateOptions(now: Date): string[];          // ['2026-10-12', '2026-10-11', … 8 items]
export const mobileDateQuerySchema = z.object({ date: isoDay });  // refine against mobileDateOptions(new Date())

export interface MobileHomeResponse {
  date: string;                 // YYYY-MM-DD (IST)
  showTasks: number;            // my fitments on that day
  approveVisit: number | null;  // OE: SUBMITTED fitments on that day I may verify; OT: null
}

export interface MyFitmentDto {
  id: string;
  tkId: string;                 // TK-00012
  status: FitmentStatus;
  fitmentAt: string;            // UTC ISO, shown in IST
  customer: string;             // client name
  site: { name: string; address: string | null; lat: number | null; lng: number | null };
  vehicleRegNo: string | null;
  activity: string;
}
export interface MyFitmentsResponse { date: string; items: MyFitmentDto[] }
```
New error code: `MOBILE_ROLE_NOT_ALLOWED` (403, message "Use the Champ web console").

Shared tests: schema bounds, `mobileDateOptions` across an IST midnight boundary (e.g. 2026-10-11T18:45Z is 12 Oct IST), and the role constants.

## 3. Rules
- **Mobile sign-in (D-128):** only roles in `MOBILE_ROLES`. Others get 403 `MOBILE_ROLE_NOT_ALLOWED` on mobile login and refresh, and no refresh token is created for them. Inactive users and wrong passwords behave as on web.
- **Home location (D-129):** only the user themselves sets it (OT or OE), via `PUT /me/home-location`. The app blocks an OT with no home location on the onboarding screen; an OE may skip.
- **Show tasks:** non-deleted fitments with `technicianId = me` whose task's `fitmentAt` falls on the selected IST day, in **any** status. Ordered by `fitmentAt`, then TK number.
- **Approve visit (OE):** `SUBMITTED` fitments on the selected IST day that the caller may verify. Use the **same scope as the F06 verification queue**. The count only; the screen comes in F12.

## 4. API (prefix `/api`)

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/mobile/auth/login` | public | Body `loginSchema`. **Same rate limiter** as `/auth/login` (shared instance or same key, so the 10/15 min limit counts across web and mobile). Returns `MobileAuthResponse`; no cookie |
| POST | `/mobile/auth/refresh` | public | Body `mobileRefreshSchema`. Rotates like web refresh; returns `MobileAuthResponse`. Role re-checked |
| POST | `/mobile/auth/logout` | public | Body `mobileRefreshSchema`. Revokes the token; 204 even if it's unknown |
| GET | `/mobile/home?date=` | OT, OE | `MobileHomeResponse` |
| GET | `/mobile/fitments?date=` | OT, OE | `MyFitmentsResponse` |
| PUT | `/me/home-location` | OT, OE | Body `setHomeLocationSchema`; returns `UserDto`. Others 403 |
| GET | `/geo/search`, `/geo/reverse` | **+ OT, OE** | Widen the role list for the home-location picker; nothing else changes |

- Dates outside `mobileDateOptions` → 400 `VALIDATION_ERROR`.
- `GET /me` and every `UserDto` include `homeLocation`. Technician list/detail DTOs include `homeLocation`.
- Mount everything in `app.ts`. The API already listens on all interfaces, so a phone on the same Wi-Fi reaches `http://<mac-lan-ip>:4000`.

## 5. Mobile app (`apps/mobile`) — Mobile agent

**Stack (D-130, D-133):**
- Expo, the latest stable SDK. Check with `npm view expo version` and pin exact versions with `npx expo install`.
- `expo-router` (typed routes), TypeScript strict, extending `tsconfig.base.json`. `@champ/shared` as a workspace dependency.
- `@tanstack/react-query`, `react-hook-form` with `@hookform/resolvers/zod` (shared schemas).
- `expo-secure-store` (refresh token), `expo-location`, `expo-constants`.
- Map: `@maplibre/maplibre-react-native` with an OSM raster style and attribution. No Google Maps SDK, so no API key is needed.
- Use a development build, not Expo Go (D-130). `ios/` and `android/` are generated (CNG) and git-ignored; config lives in `app.config.ts`.
- Bundle ids: `in.intellicar.champ` and `in.intellicar.champ.dev`.
- **pnpm:** make Metro work with the existing pnpm workspace. Do **not** change the repo-wide `node-linker`. If that proves impossible, stop and report.

**API base URL:** `EXPO_PUBLIC_API_URL` if set. Otherwise derive it from the Metro host (`Constants.expoConfig?.hostUri` host + `:4000`), so the simulator, emulator and a phone on the same Wi-Fi all work. On the Android emulator, `localhost` maps to `10.0.2.2`.

**Session:**
- The access token lives in memory; the refresh token lives in SecureStore.
- On launch: refresh, then `GET /me`.
- A single in-flight refresh on 401, retried once; if that fails, sign out.
- *Sign out* calls `/mobile/auth/logout` and clears the store.
- Network failure (no response) shows the **No connection** screen (illustration, *Retry*). A 5xx shows a toast-style error.

**Screens (expo-router):**

| Route | Content |
|---|---|
| `/sign-in` | Brand header, email, password with show/hide, *Sign in*. Server messages shown verbatim; 403 `MOBILE_ROLE_NOT_ALLOWED` shows "Use the Champ web console" |
| `/onboarding/home-location` | Map with a centre pin; *Use my current location* (permission prompt; a denied permission explains how to enable it); address search (`/geo/search`, debounced); the pin's address via `/geo/reverse`; *Save*. OT can't leave without saving; OE gets *Skip* |
| `/(app)/home` | Header: date chip opening a picker of `mobileDateOptions` (Today, Yesterday, then dates), and a bell (disabled, tooltip "Coming soon"). Tiles: **Show tasks** (count → list) and, for OE, **Approve visit** (count, "Coming in a later update"). Pull to refresh |
| `/(app)/tasks` | `MyFitmentsResponse` for the header date: cards with TK id, status badge (web colours), time in IST, customer, site and address, vehicle, activity. Empty state with illustration |
| `/(app)/profile` | Name, email, role, job title, phone, manager name and phone (`tel:` link), home location with *Change* (opens the onboarding screen in edit mode), app version, *Sign out* |

- The selected date is app state shared by the home and tasks screens. The home tile and the list use the same `date`.
- **Look and feel:** the CR-03 brand colour and light/dark tokens ported to a small theme module, a system font, and unDraw-style illustrations (reuse the web SVGs through `react-native-svg`) for empty, error and no-connection states.
- File and folder names are kebab-case. Extend the ESLint config so expo-router names (`_layout.tsx`, `(app)`, `[id].tsx`, `+not-found.tsx`) pass, and add `apps/mobile` with react-hooks rules and RN globals.

**Tests (Jest + `jest-expo` + `@testing-library/react-native`), wired into `pnpm test` and `pnpm typecheck`:**
- sign-in (validation, server message, role refusal)
- session restore and refresh-on-401 (mock fetch and SecureStore)
- onboarding (OT can't skip, OE can; save sends the body; denied-permission message)
- home (counts, OE-only tile, date change refetches with the new `date`)
- date picker options
- tasks list (cards, empty state)
- profile (fields, `tel:` link, sign out)
- no-connection screen and *Retry*

**Agents do not run native builds** (`expo run:*`, `prebuild`): they take longer than the time box. The agent proves the app with `pnpm --filter @champ/mobile exec expo-doctor`, `expo export --platform ios --platform android` (JS bundle resolves in the monorepo) and the Jest suite. Claude runs the first native builds during verification.

## 6. Web (Backend agent)
- The technician detail/list on web shows **Home location**: the address, an "Open map" link to `https://www.openstreetmap.org/?mlat=…&mlon=…#map=17/…/…`, and "Updated <IST date>". Shows "Not set" when there is none. It's read-only for every role (D-129).
- Add a web unit test, and extend an existing E2E assertion only if it's cheap (the technician page shows "Not set").

## 7. Tests (Backend)
API (Vitest + Supertest), covering:
- **Mobile login:** OT and OE get 200 with a refresh token and no cookie. SA, OM and RO get 403 `MOBILE_ROLE_NOT_ALLOWED` with no token row created. Wrong password and inactive user behave as on web. The rate limit is shared with the web login.
- **Refresh:** rotation; reuse of the old token fails; a user whose role changed to OM gets 403.
- **Logout:** revokes; an unknown token still returns 204.
- **`PUT /me/home-location`:** OT and OE succeed; others 403; bounds validated; `/me` and the technician DTOs show it.
- **`/mobile/home` and `/mobile/fitments`:**
  - IST day boundaries
  - only my fitments
  - deleted tasks excluded
  - every status counted
  - ordering
  - OE `approveVisit` matches the verification scope; OT gets null
  - dates outside the window → 400
  - SA/OM/RO → 403
- **`/geo`:** OT is allowed now; RO is still refused.

## 8. Definition of done
- Backend: migration applied to the dev DB (`pnpm db:migrate`). `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e` pass once at the end.
- Mobile: `pnpm --filter @champ/mobile test` and `typecheck` pass, `expo-doctor` is clean (or its warnings explained), and `expo export` succeeds for both platforms. Root `pnpm lint` and `pnpm typecheck` pass.
- Each agent reports its wall time and E2E/debug minutes, its decisions as proposed D-numbers (Claude adds them to the log), and its README notes (Claude writes `README.md`, `test-report.md` and the decision log).
