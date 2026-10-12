# F14 — Technical Spec

Implements `intent.md` (approved 2026-10-12). Binding decisions: D-025 (RO read-only), D-050 (cmdk via shadcn Command), D-063, D-127, D-238 (`/tasks/:id?fitment=` deep link), D-242–D-246, plus everything from F01–F13. Reuse, don't duplicate:
- `parseTaskId` and the id formatters (`formatOmId`, `formatOeTaskId`/equivalent, `formatTkId`, `formatTtId`) in `packages/shared`
- `TASK_VIEW_ROLES`, `requireRole`, `validate`, the error helpers; travel visibility from `apps/api/src/modules/travel`
- web: `components/layout/app-shell.tsx` (the F13 bell sits in the top bar), shadcn `Command` (cmdk), React Query, `lib/api.ts`, `components/layout/nav.ts`, the F13 `?fitment=` link and the travel `?tt=` link

Two parallel agents (D-127):

| Agent | Owns |
|---|---|
| **Backend** | `packages/shared`, `apps/api`: §1–§4, §7 |
| **Web** | `apps/web` (incl. `e2e/`): §5–§6 |

**Only the Web agent runs the full gates** (`pnpm test:e2e` included) at the end; the Backend agent runs the API/shared suites and typecheck/lint/build (lesson from F13: parallel full runs on the shared test databases cause false failures).

## 1. Shared (`packages/shared/src/search.ts`, exported). Backend commits it FIRST.

```ts
export const SEARCH_IDENTIFIERS = [
  'OM_ID', 'OE_TASK_ID', 'TK_ID', 'TT_ID',
  'DEVICE_ID', 'SECONDARY_DEVICE_ID', 'OLD_DEVICE_ID', 'CHASSIS_NO', 'ASSET_NO', 'VEHICLE_REG_NO',
] as const;
export type SearchIdentifier = (typeof SEARCH_IDENTIFIERS)[number];
export const SEARCH_IDENTIFIER_LABELS: Record<SearchIdentifier, string>; // 'OM id', 'OE task id', 'TK id', 'Travel task id', 'Device id', 'Secondary device id', 'Old device id', 'Chassis no.', 'Asset no.', 'Vehicle reg. no.'
export const SEARCH_MIN_CHARS = 3;
export const SEARCH_MAX_RESULTS = 20;

/** Lower-case, spaces and hyphens removed: the form both sides are compared in (D-245). */
export function normalizeIdentifier(text: string): string;
/** OM/OE/TK/TT id or a bare number (→ OM, OE and TK), else null. Extends parseTaskId with TT. */
export function parseSearchId(text: string): { prefix?: 'OM' | 'OE' | 'TK' | 'TT'; number: number } | null;

export const globalSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(100).default(SEARCH_MAX_RESULTS),
});

export interface SearchMatch { identifier: SearchIdentifier; value: string /* the stored value, as stored */ }
export interface SearchFitmentHit { fitmentId: string; tkId: string; status: FitmentStatus; vehicleRegNo: string | null; matches: SearchMatch[] }
export interface SearchTaskHit {
  kind: 'TASK';
  taskId: string; omId: string; oeTaskId: string; customer: string; site: string; status: TaskStatus;
  matches: SearchMatch[];            // task-level matches (OM id, OE task id)
  fitments: SearchFitmentHit[];      // fitments that matched (empty when only the task matched)
}
export interface SearchTravelHit { kind: 'TRAVEL'; travelTaskId: string; ttId: string; technician: string; status: TravelStatus; matches: SearchMatch[] }
export type SearchHit = SearchTaskHit | SearchTravelHit;
export interface GlobalSearchResponse { q: string; hits: SearchHit[]; total: number /* fitment + task + travel hits before the limit */; truncated: boolean }

export interface SearchIdentifierSettingDto { identifier: SearchIdentifier; label: string; enabled: boolean; sortOrder: number }
export const updateSearchIdentifiersSchema = z.object({
  items: z.array(z.object({ identifier: z.enum(SEARCH_IDENTIFIERS), enabled: z.boolean() })).length(SEARCH_IDENTIFIERS.length),
  // the array order is the ranking order; every identifier exactly once; at least one enabled
});
```

## 2. Data model (additive migration; folder name must sort after `20261012900000_notifications`, e.g. `20261013000000_global_search`)
- `SearchIdentifierSetting { identifier String @id, enabled Boolean @default(true), sortOrder Int }`, seeded in the migration with all ten, enabled, in the order of `SEARCH_IDENTIFIERS` (also in `prisma/seed.ts` if the seed truncates).
- `CREATE EXTENSION IF NOT EXISTS pg_trgm;` and GIN trigram **expression** indexes on `regexp_replace(lower(col), '[\s-]', '', 'g')` for Fitment `deviceId`, `secondaryDeviceId`, `oldDeviceId`, `chassisNo`, `assetNumber`, `vehicleRegNo`. (Check the API test DB setup creates the extension too — the migration runs there.)

## 3. Rules
- **Who:** `TASK_VIEW_ROLES` (SA, OM, OE, RO) for search; OT → 403. Settings: read for SA; update SA only (others 403).
- **Query:** `q` trimmed. If `parseSearchId(q)` matches → exact lookups for the enabled numbered identifiers (bare number → OM, OE and TK; `TT…` → travel). Otherwise, if `normalizeIdentifier(q).length >= SEARCH_MIN_CHARS` → "contains" on the enabled text identifiers using the normalized expression (`LIKE '%' || $1 || '%'`, the pattern escaped for `%`, `_` and `\`). Shorter → empty result (200, no error). A query can be both (e.g. `112` is also a substring of device ids): run both and merge.
- **Visibility (D-244):** tasks not deleted; travel tasks per the existing travel list visibility for the role.
- **Grouping and ranking:** fitment matches are grouped under their task; a task appears once. Ranking: exact id matches first, then by the identifier's `sortOrder`, then exact normalized equality before contains, then newest task first. `limit` applies to fitment rows + task-only hits + travel hits; `truncated` when more existed.
- Use one parameterised raw SQL query (or a few) for the contains part — no N+1; load task/fitment display fields in one follow-up query.

## 4. API (prefix `/api`)

| Method | Path | Notes |
|---|---|---|
| GET | `/search?q=&limit=` | `GlobalSearchResponse` |
| GET | `/search/identifiers` | `SearchIdentifierSettingDto[]` in ranking order (SA) |
| PUT | `/search/identifiers` | body `updateSearchIdentifiersSchema`; returns the list (SA) |

## 5. Web agent (`apps/web`)
- **Top-bar search** (`src/features/search/global-search.tsx`), next to the F13 bell, for `TASK_VIEW_ROLES`:
  - desktop: an input-looking button "Search ids… ⌘K" that opens a `CommandDialog` (shadcn/cmdk); **Ctrl/⌘ K** opens it from anywhere; phones (< md): a search icon opening the same dialog full-screen.
  - debounced (250 ms) `GET /search`; shows "Type at least 3 characters" below the minimum (unless it parses as an id), a loading row, "No matches for …", and grouped results: task row (OM id · customer · site · status badge) with its fitment rows indented (TK id · reg no. · "Device id: **LAF5-00123**" · status), travel rows (TT id · technician · status). The matched part of the value is highlighted (compare normalized, highlight on the original by mapping indexes, or highlight the whole value if mapping is awkward).
  - Enter/click: task → `/tasks/:taskId`; fitment → `/tasks/:taskId?fitment=:fitmentId`; travel → `/tasks/travel?tt=:id`. Arrow keys come from cmdk. Esc closes.
  - "Show all results" when `truncated` → `/search?q=` results page (`src/features/search/search-page.tsx`) with `limit=100`, same grouping, as a list/cards on phones.
- **Settings** (SA only): `/settings/search` "Search identifiers" — a list of the ten with a switch each and up/down buttons for the order (keyboard accessible; no drag needed), *Save* (PUT), validation "Keep at least one identifier on". Nav: a "Settings" section with "Search identifiers" for SA only.
- **Tests:** unit tests for the dialog (shortcut, min chars, grouping, highlight, navigation targets, empty/loading/error) and the settings page (toggle, reorder, save body, at-least-one rule, non-SA sees no nav/403 page). **E2E** (`e2e/search.spec.ts`, desktop and mobile-360): search a device id set through the dev simulator's form fill (or a TK id) and open the fitment's sheet; SA switches *TK id* off and a TK search no longer finds it (switch it back on at the end).

## 6. Definition of done
- **Backend:** migration applied to the dev DB (check `prisma migrate status`; the folder sorts last); `pnpm --filter @champ/shared test`, `pnpm --filter @champ/api test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`. **No E2E run.**
- **Web:** web unit tests, the new E2E spec on desktop and mobile-360, then the **full gates once** after the Backend agent reports done (wait for its last commit), and report.
- Each agent reports its wall time, debugging minutes, proposed decisions (B-1…, W-1…) and README notes. Claude writes the docs.

## 7. Backend tests
- shared: `normalizeIdentifier`, `parseSearchId` (prefixes, case, spaces, leading zeros, TT, bare numbers, junk)
- search: each identifier found (exact ids; contains for the text ones ignoring case/space/hyphen); bare number → OM/OE/TK; min length; grouping under the task; ranking by sortOrder; limit + truncated; deleted tasks hidden; `%`/`_` in the query are literal; disabled identifier not searched; OT 403
- settings: GET order; PUT reorders and toggles; at least one enabled; every identifier exactly once; non-SA 403
