# F11 — Technical Spec

Implements `intent.md` (approved 2026-10-12). Binding decisions: D-008, D-021, D-108, D-127, D-156, D-158, D-177/D-178 (keyboard padding), D-180–D-186, D-190, D-201–D-205, plus everything from F01–F10B. Reuse, don't duplicate:
- the F04 CSV parsing (`apps/api/src/modules/tasks/bulk.ts`: papaparse, BOM strip, binary check, `normalizeCsvHeader`, `toCsv`, row numbers counting the header as row 1) and the upload middleware pattern from `verification/upload.ts` (role check before multer reads the file)
- the F10B form service (`apps/api/src/modules/mobile/form.ts`: `mergeForm`, `formDiff`, `toFormDto`, `assertFormEditable`, `assertReadyToSubmit`) and shared `fitment-form.ts` (`fitmentFormSchema`, `missingForSubmit`, `requiredPhotoKinds`, labels)
- the workflow engine (`transitionFitment`) for START and SUBMIT, and the route-order check (`mobile/route.ts` `assertRouteOrder`)
- on mobile: the api client, theme, `Dialog`, toast, `lib/location.ts` (`requireFreshFix`), `PhotoSlot`, `StateView`, the F10B screens as patterns

Two parallel agents (D-127):

| Agent | Owns |
|---|---|
| **Backend** | `packages/shared`, `apps/api`, `apps/web`: §1–§4, §7 |
| **Mobile** | `apps/mobile` (screens, routes, new deps, `app.config.ts`, lockfile): §5–§6 |

The Mobile agent codes against the shared contracts in §1, which the Backend agent commits **first**.

## 1. Shared (`packages/shared/src/bulk-fill.ts`, exported). Backend commits it FIRST and reports it.

```ts
/** CSV columns, in this order. tk_id is required in the header; the others are optional (a missing column = blank). */
export const BULK_FILL_COLUMNS = [
  'tk_id', 'vehicle_reg_no', 'chassis_no', 'cluster_reading_km',
  'asset_condition', 'accessories', 'vehicle_battery_condition', 'cluster_meter_reading', 'can_voltage',
  'device_replacement', 'device_id', 'secondary_device_id', 'comments',
] as const;
export type BulkFillColumn = (typeof BULK_FILL_COLUMNS)[number];
export const BULK_FILL_MAX_ROWS = 500;
export const BULK_FILL_MAX_BYTES = 1_000_000;

/** Lenient cell parsing (case-insensitive, trimmed): checks 'OK' | 'Not OK' | 'NOT_OK' | 'NA' | 'N/A' | 'Not applicable';
 *  replacement 'Device' | 'SIM' | 'No' | 'None'. Returns the value or an error message naming the allowed values. */
export function parseCheckCell(text: string): { value: CheckValue } | { error: string };
export function parseReplacementCell(text: string): { value: DeviceReplacement } | { error: string };

/** One CSV row → a partial FitmentFormInput (blank cells are left out, D-205) plus per-cell errors.
 *  Uses fitmentFormSchema's rules for lengths, km range and device-id upper-casing. */
export function csvRowToForm(row: Partial<Record<BulkFillColumn, string>>): { form: FitmentFormInput; errors: BulkCellError[] };

export interface BulkFillFitmentDto {
  fitment: MyFitmentDto;            // photos: [] as in lists (D-185)
  /** missingForSubmit labels (empty = ready); for ASSIGNED/REOPENED fitments too. */
  missing: string[];
  /** Required photo kinds with no active photo, in walk-through order BEFORE, ASSET, CLUSTER, PLACEMENT, AFTER. */
  missingPhotos: RequiredPhotoKind[];
}
export interface BulkFillTaskDto {
  taskId: string; omId: string; customer: string; site: MyFitmentDto['site']; fitmentAt: string;
  fitments: BulkFillFitmentDto[];   // the caller's fitments of the task, by seq
}

export interface BulkFillPreviewRow {
  rowNumber: number;
  tkId: string;                     // as written in the file
  fitmentId: string | null;
  form: FitmentFormInput;           // what will be filled (blank cells left out)
  /** The fitment is Assigned/Reopened and will be started on Confirm. */
  willStart: boolean;
  errors: BulkCellError[];          // { column, message }; column '' = the row
  valid: boolean;
}
export interface BulkFillPreviewResponse { rows: BulkFillPreviewRow[]; validCount: number; invalidCount: number; startCount: number }

export const bulkFillConfirmSchema = z.object({
  rows: z.array(z.object({ rowNumber: z.number().int(), tkId: z.string(), form: fitmentFormSchema })).min(1).max(BULK_FILL_MAX_ROWS),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),   // both or neither; required when any row needs starting
});
export interface BulkFillConfirmResponse {
  filled: string[];                 // TK ids
  started: string[];
  failed: { rowNumber: number; tkId: string; code: string; message: string }[];
}
export interface SubmitReadyResponse {
  submitted: string[];
  incomplete: { tkId: string; missing: string[] }[];
  /** Not In progress (already submitted, verified, closed…): left alone. */
  skipped: string[];
}
```

- `MyFitmentDto` gains `taskFitmentCount: number`: the caller's fitments in the same task (any status). The app shows *Bulk fill (CSV)* when it is ≥ 2.
- New event type `FITMENT_FORM_CSV_FILLED`, label **"Filled from CSV"** (Prisma enum migration + `TASK_EVENT_LABELS`). Its data is `{ tkId, ...readable diff }` as D-190, so the existing history renderers show it unchanged.
- `startBulkFillMessage`/error codes: `GPS_REQUIRED` (400, "Turn on location to start the fitments"), reuse `ROUTE_ORDER`, `FITMENT_LOCKED`, `FORM_INCOMPLETE`.

## 2. Rules
- **Who:** the assigned technician (OT, or OE when assigned, D-158). The task must have at least one of the caller's fitments, else 404. Another person's fitment in the task never appears in the sample, the screen or the results.
- **Preview** validates each row, writes nothing:
  - header must contain `tk_id` (else 400 `VALIDATION_ERROR` with `fieldErrors.file`); unknown columns are ignored; at most 500 rows and 1 MB; empty file → 400.
  - `tk_id` is parsed with the shared `parseTaskId` (TK prefix optional). Row errors: unknown TK id / not in this task; not your fitment; the same TK id twice (both rows invalid); status not fillable — fillable are ASSIGNED, REOPENED (will start), IN_PROGRESS and SUBMITTED (D-184); OE_VERIFIED and later → "Already verified — read only"; closed / faulty / open → "This fitment is <status label>".
  - cell errors from `csvRowToForm`. A row with no filled cell besides `tk_id` is valid only if it needs starting; otherwise "Nothing to fill".
- **Confirm** (D-021, D-202, D-205): validates the rows again (the file may be stale), then:
  1. If any valid row needs starting and `lat`/`lng` are missing → 400 `GPS_REQUIRED`, nothing written.
  2. Rows are applied in `seq` order, **each fitment in its own transaction** (one failure doesn't block the rest; failures go to `failed`).
  3. A fitment that is ASSIGNED/REOPENED is started through `transitionFitment(actor, id, 'START', { lat, lng })` first (the normal START event and route-order check apply).
  4. The form is merged with `mergeForm`, `formUpdatedAt` set, and **one** `FITMENT_FORM_CSV_FILLED` event is written with the diff (also while In progress, unlike autosave). No diff → no event, but the fitment still counts as filled.
- **Route order relaxed within a task (D-202):** `assertRouteOrder` ignores fitments of the **same task** — an In-progress fitment of the same task doesn't block, and same-task fitments earlier in the stored route don't block. Fitments of other tasks block exactly as before. The day route's `isNext`/`blockedBy` must stay consistent with this (an open stop of a task that already has an In-progress fitment is startable). Starting one by one from the fitment screen benefits from the same relaxation.
- **Submit ready (D-204):** for each of the caller's IN_PROGRESS fitments of the task in `seq` order, compute `missingForSubmit`; complete → `transitionFitment(…, 'SUBMIT')` in its own transaction; incomplete → `incomplete` with labels; other statuses → `skipped`. A `FORM_INCOMPLETE` from the engine (race) goes to `incomplete`.
- **Sample CSV:** header `BULK_FILL_COLUMNS`, one row per caller fitment of the task (by `seq`) whose status is fillable, with `tk_id`, and reg/chassis from the form, falling back to the task's vehicle values; the other cells empty. UTF-8 with BOM, CRLF (`toCsv`). Filename `bulk-fill-OM-00012.csv`.

## 3. API (prefix `/api/mobile`, OT/OE; `authenticate` + `requireRole(MOBILE_ROLES)` like the other mobile routes)

| Method | Path | Notes |
|---|---|---|
| GET | `/tasks/:taskId/bulk-fill` | `BulkFillTaskDto` |
| GET | `/tasks/:taskId/bulk-fill/sample.csv` | `text/csv; charset=utf-8`, `Content-Disposition: attachment` |
| POST | `/tasks/:taskId/bulk-fill/preview` | multipart `file` (≤ 1 MB, CSV/text; reject binary); the caller-has-fitments check runs **before** multer reads the file (D-108). Returns `BulkFillPreviewResponse` |
| POST | `/tasks/:taskId/bulk-fill/confirm` | body `bulkFillConfirmSchema`; returns `BulkFillConfirmResponse` |
| POST | `/tasks/:taskId/submit-ready` | no body; returns `SubmitReadyResponse` |

New code in `apps/api/src/modules/mobile/bulk-fill.ts`, routes added to `mobile/router.ts`.

## 4. Web
No new screens. The task history and the verification sheet's history show "Filled from CSV" with its diff (check the existing renderer handles the new type; add a unit test).

## 5. Mobile (`apps/mobile`)
**Dependencies** (`npx expo install`, exact versions, SDK 57): `expo-document-picker` (pick the CSV), `expo-sharing` (share the sample). `expo-file-system` is already there. No native builds (Claude builds).

**Entry points** (shown only when `fitment.taskFitmentCount >= 2`):
- Fitment screen: a secondary button **Bulk fill (CSV)** under the main actions.
- Route timeline: on the stop row, a small *Bulk fill* link for the first stop of each task with ≥ 2 fitments.
Both open `/task/[taskId]/bulk-fill`.

**Bulk screen** (`/task/[taskId]/bulk-fill`, `src/screens/bulk-fill-screen.tsx`):
- Header: OM id, customer, site, date. Counts: "12 fitments · 5 ready to submit".
- List of fitments: TK id, reg no., status badge, and a progress line: "Form ✓ · Photos 2 of 4 · Submitted". Missing items are listed under it (small text). Tap → the fitment screen.
- Actions: **Download sample CSV** (fetch with auth → write to the cache directory → `Sharing.shareAsync` with `text/csv`; if sharing isn't available, a toast with the path), **Upload CSV** (`DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/vnd.ms-excel'], copyToCacheDirectory: true })` → multipart to `/preview`), **Add photos** (when any `missingPhotos`), **Submit ready (n)** (when n ≥ 1 fitments are In progress with nothing missing).
- **Preview** (a full-screen step on the same route or `/task/[taskId]/bulk-fill/preview`; keep the preview in memory, not in the URL):
  - summary "18 ready, 2 with problems · 6 will be started"
  - valid rows (green): TK id and the values that will be filled, readable labels (`CHECK_LABELS`, `CHECK_VALUE_LABELS`, field labels); "Will be started" tag
  - invalid rows (red): row number, TK id and each cell's reason
  - **Confirm (n)** disabled when 0 valid. If `startCount > 0`, get a fix with `requireFreshFix()` first; denied/unavailable → a message and nothing is sent. Send only the valid rows. Then show the result (filled, started, failed with reasons) in a dialog, invalidate the bulk, route, home and fitment queries, and return to the bulk screen.
- **Add photos walk-through** (`/task/[taskId]/photos`): goes through the fitments with missing photos in `seq` order and, within each, the missing kinds in order (before → asset → cluster → placement → after). One `PhotoSlot` at a time with a header "TK-00012 · KA01AB1234 — 2 of 9", *Skip* and *Next* (Next enabled after upload). Done → back to the bulk screen (refetch). Photos can only be added to In-progress or Submitted fitments; Assigned ones are skipped with a note "Start it first (Confirm a CSV or Start)".
- **Submit ready:** a confirm dialog "Submit 5 fitments?" → POST → a result dialog: submitted TK ids and the incomplete ones with what's missing → refetch.
- Keyboard padding as D-177/D-178 wherever there is input. Errors via the existing toast/StateView patterns.

## 6. Mobile tests (Jest, mock the native modules in `src/test/setup.ts`, extending the existing mocks)
- bulk screen: counts and progress lines, entry hidden when < 2, Submit ready count, Add photos visibility
- sample download: fetch → write → share called with `text/csv`
- upload → preview: valid/invalid rendering, counts, Confirm disabled at 0
- confirm: GPS fetched only when `startCount > 0`, denied GPS sends nothing, body contains only valid rows with lat/lng, result dialog
- photos walk-through: order across fitments and kinds, Skip/Next, Assigned skipped
- submit ready: dialog and result
- fitment screen and route row: *Bulk fill* entry by `taskFitmentCount`

## 7. Backend tests (Vitest + Supertest; `apps/api/test/bulk-fill.test.ts`, shared unit tests)
- shared: `parseCheckCell`, `parseReplacementCell` (lenient spellings, errors), `csvRowToForm` (blank cells left out, km and lengths, device id upper-case)
- GET bulk-fill: only the caller's fitments; 404 for a task without them; `missing`/`missingPhotos`
- sample: header, rows, reg/chassis fallback, attachment headers
- preview: missing `tk_id` column, too many rows, binary file, unknown TK, other technician's TK, duplicate TK, verified fitment, bad cells, "Nothing to fill", `willStart`, refusal before parse for a stranger
- confirm: blank keeps existing values (D-205), filled overwrites; starts Assigned fitments with one fix; `GPS_REQUIRED` writes nothing; one event "Filled from CSV" with a diff; a stale row (fitment verified in between) fails alone; route order relaxed within the task and still enforced across tasks
- `assertRouteOrder`: same-task In-progress doesn't block; other-task still does; the day route `isNext` consistent
- submit ready: submits complete, lists incomplete with labels, skips others
- web: history renders "Filled from CSV"

## 8. Definition of done
- **Backend:** migration applied to the dev DB; full gates once at the end (`pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e`; failures only inside `apps/mobile` are reported, not fixed).
- **Mobile:** `pnpm --filter @champ/mobile test`, mobile typecheck, root lint, `expo-doctor`, `expo export` for both platforms (after Backend has committed the contracts).
- Each agent reports its wall time, debugging minutes, proposed decisions (Backend B-1…, Mobile M-1…) and README notes. Claude writes the docs, makes the new development builds (iOS + Android, new native modules) and smoke-tests the API flow on an isolated API.
