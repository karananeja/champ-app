# F06 — Test Report

| | |
|---|---|
| Date | 2026-10-12 |
| Branch | `feature/F06-oe-verification` |
| Environment | macOS, Node 24, pnpm 10.33, Docker (postgres:16-alpine, pgsty/minio), Chromium (Playwright 1.64) |
| Result | **All gates pass**: typecheck, lint, 696 unit/integration tests, 51 E2E tests (2 skipped by design), build with bundle check |

## 1. Definition of done

| Step | Command | Result |
|---|---|---|
| Migrate (dev DB with UAT data) | `pnpm db:migrate` | `20261012300000_oe_verification` applied on top of the six earlier migrations; `prisma migrate status`: up to date. Additive only: 3 enums, 8 nullable columns on `Fitment`, tables `FitmentPhoto` and `FitmentAccessory`, indexes and FKs. Existing rows untouched (10 fitments before and after, `billable` null on all) |
| Storage | a short `tsx` script with `createStorage()` against the running MinIO, then the API started on spare port 4200 and stopped | `ensureBucket` OK on bucket `champ`; put → presigned GET 200; the same object without a signature → **403** (bucket private); test object deleted. API start logged *"Photo storage ready (bucket "champ")"*; `/api/health` `{"ok":true,"db":"up"}`; stopped with SIGTERM, nothing left running |
| No dev-DB user data used | — | No tokens were minted for real users; API behaviour was checked by the automated suites only |

## 2. Quality gates

| Command | Result |
|---|---|
| `pnpm typecheck` | exit 0 (shared, api, web) |
| `pnpm lint` | exit 0: 0 errors, 0 warnings |
| `pnpm test` | exit 0: **696 passed / 0 failed** (shared 247, api 288, web 161) |
| `pnpm test:e2e` | exit 0: **51 passed / 0 failed / 2 skipped** (the CR-02 sidebar and read-only specs run on desktop only) |
| `pnpm build` | exit 0; *"Bundle check: no dev simulator in dist"*. The lightbox is its own lazy chunk (42 kB, 15 kB gzip). Vite's existing "chunk larger than 500 kB" warning for the main chunk remains |

| Suite | Before (F05 + CR-03/04) | After |
|---|---|---|
| `packages/shared` | 232 | **247** (+15, `test/verification.test.ts`) |
| `apps/api` | 270 | **288** (+18: `verification.test.ts` 7, `photos.test.ts` 6, `storage.test.ts` 5) |
| `apps/web` | 143 | **161** (+18: `verification-sheet.test.tsx` 5, `photo-gallery.test.tsx` 10, `task-table.test.tsx` +2, `task-history.test.tsx` +1) |
| E2E | 49 + 2 skipped | **51 + 2 skipped** (+2: `verification.spec.ts`, 1 test × 2 viewports) |

### 2.1 Shared (`test/verification.test.ts`)
`missingVerificationFields` and its messages; the **`canEditVerification` / `canManagePhotos` matrices** (task OE, OM,
SA, RO, other OE, OT × every status), OE blocked after OM approval, `isVerificationEditor`, photo history roles; draft
schema (partial, nulls, blank remarks → null, 1000-character limit), VERIFY with and without fields, photo reasons
3–300, DEBUG-only upload kind, export `level`, photo sort order, billable labels.

### 2.2 API (`champ_test`, in-memory storage)
- `verification.test.ts`: **draft save** with partial fields, nulls and accessory replacement, readable diff events,
  no event when nothing changed; **wrong kind / unknown → `INVALID_REFERENCE`, changed inactive → `INACTIVE_REFERENCE`,
  unchanged inactive kept**; **VERIFY incomplete → 400 `VERIFICATION_INCOMPLETE`** with `missing` and `fieldErrors`,
  inline fields rolled back when still incomplete, **VERIFY with inline fields** writes `FITMENT_VERIFICATION_SAVED`
  then `FITMENT_VERIFIED` (with `finalIssue`, `billable`); **billable snapshot** (true/false at verify, master flag flip
  doesn't change it, a new final issue after verify re-snapshots, required fields can't be cleared once verified,
  reopen clears billable and keeps the fields, list `verifiedCount` / `billableCount`); **edit locks** (before submit
  409; SA, RO, other OE, OT 403; OM on Submitted; OE after verify; OE after approval 409 `FITMENT_LOCKED`; OM after
  approval with `postApproval`); **task detail** flags per role and status, verification names, photo counts;
  **fitment-level export** CSV columns and values, task-level verified/billable counts, xlsx sheet *Fitments*.
- `photos.test.ts`: **simulator submit attaches 5 photos** (kinds, technician as uploader, `SIMULATOR`, site GPS,
  taken time, 800×600, objects stored) and OT remarks, one `PHOTO_ADDED` event; **list order** and presigned URLs for
  SA/OM/OE/RO, OT 403, 404; **debug upload** (JPEG; a PNG named `.jpg` stored as PNG), **technician kind refused**,
  **> 10 MB → 400 `FILE_TOO_LARGE`**, **text file named `.jpg` → 400 `UNSUPPORTED_FILE`**, missing file, SA/RO 403;
  **replace** keeps the original as `REPLACED` linked to the new photo (object kept), second replace 409; **remove**
  with reason (empty 400, RO 403); **history** for SA/OM/task OE, 403 for RO and other OEs; events; **after OM
  approval** OE replace/upload/remove 409, OM allowed with `postApproval`; **orphan cleanup** when the DB write fails.
- `storage.test.ts`: `S3Storage` with a mocked client: **put key and content type**, **presigned URL on
  `S3_PUBLIC_URL`** (path style, `X-Amz-Expires=600`, no request sent), `ensureBucket` creates a missing bucket (no
  policy call) and leaves an existing one, errors propagate, `exists` 404 → false; driver selection and credentials.
- Existing F05 tests updated **only where VERIFY now requires fields** (they pass the world's verification fields;
  expectations gain the `FITMENT_VERIFICATION_SAVED` event and the verify event's `finalIssue`/`billable`):
  `workflow.test.ts`, `workflow-views.test.ts`, `tasks-completed.test.ts`, `tasks-summary.test.ts`.

### 2.3 Web (jsdom)
- `verification-sheet.test.tsx` (5): technician work beside the form (OT remarks, grouped photos); **Verify with
  empty fields shows the three inline errors and calls nothing**; **live billable badge** Yes/No; Verify sends every
  field; Save draft sends partial entries; a server `VERIFICATION_INCOMPLETE` maps to the fields; **read-only mode** for
  an RO (inactive value labelled, no inputs or buttons, inline final issue + billable in the row); editing a verified
  fitment keeps the snapshot badge.
- `photo-gallery.test.tsx` (10): **grouping** in kind order with uploader and IST time; EmptyState; lightbox opens with
  the GPS caption; **Replace dialog** (file and reason required, multipart with reason, server error verbatim, success);
  **Remove dialog** (reason required, posted); no manage buttons without `canManage`; **Show history** (greyed photo,
  "Replaced by … · time · reason"); **upload validation** (types, 10 MB, empty), debug upload refuses a PDF and an
  oversize file before sending, shows progress and the server's message verbatim, refreshes on success.
- `task-table.test.tsx` (+2): **Billable column** ("3 / 5", "—") in All tasks and not in Open tasks; **Download →
  Fitments (CSV)** requests `level=fitment`. `task-history.test.tsx` (+1): photo lists and verification diffs.

### 2.4 E2E (desktop 1280×720 and mobile 360×740, real MinIO bucket `champ-e2e`), `e2e/verification.spec.ts`
One test per viewport: the OE simulates Start and Submit → opens **Verify**: OT remarks and 5 photos (all loaded
from MinIO) → Verify shows the missing fields → *Device fault* shows **Billable: No**, *Wiring issue* **Billable: Yes**
→ a fake `.jpg` is rejected by the server and a `.txt` in the browser, a real JPEG is added as a debug image → Verify
→ OE verified with the final issue and billable badge in the row → **Photos**: lightbox opens and Escape closes only
the lightbox → **Replace** the Before photo with a reason → **Show history** shows the original "Replaced by <OE> …
reason" → the OM sees the verification on the task page and final-approves → the OE sees no Replace/Remove and a
read-only *View verification* → **Completed tasks** shows Billable "1 / 1" → **Fitments (CSV)** downloads with the
TK, final issue and "Yes". No horizontal overflow on the sheet, viewer and list.

Existing E2E changes: `workflow.spec.ts` verifies through the sheet (new `verifyInSheet` helper) and expects 7 raw
events instead of 5 (simulated `PHOTO_ADDED` and `FITMENT_VERIFICATION_SAVED`); `org.setup.ts` sends the verification
fields with its API VERIFY calls and creates the F06 accounts and tasks; `tasks.spec.ts` and `cr-04.spec.ts` pick the
Download menu items with `exact: true`, since "Fitments (CSV)" also contains "CSV".

## 3. Known limitations
- **No technician app yet.** Technician photos and OT remarks come from the dev simulator; the F10 mobile API will
  upload them (and give the OT access to their own photos). A resubmit after a reopen keeps the existing simulator
  photos.
- **Photos are served by MinIO directly** through presigned URLs on `S3_PUBLIC_URL` (`http://localhost:9000`). Opening
  the web app from another device (e.g. a phone on the LAN) needs `S3_PUBLIC_URL` set to an address that device can
  reach.
- **No image processing**: no thumbnails, resizing or EXIF reading on the server; thumbnails are the full images
  scaled by the browser. Debug images have no taken time or GPS (uploaded time is shown).
- **Accessories and remarks aren't required**, as agreed (D-098); there is no billable override (D-101).
- **Storage outage**: the API starts anyway and logs it; photo calls answer 503 until MinIO is back.
- The **fitment export** with a technician filter lists only that technician's fitments.

## 4. UAT checklist

0. [ ] `docker compose up -d`, `pnpm install`, `pnpm db:migrate`, `pnpm db:seed`, then `pnpm dev`. `.env` needs the
   `S3_*` values from `.env.example` (and `S3_PUBLIC_URL`, default `http://localhost:9000`); the API log shows *Photo
   storage ready*. You need an OM, an OE and a technician; as the OM create a task for 2 vehicles with OE = your OE
   and the technician assigned. Masters must have active Issues observed, Actions taken, Final issues (at least one
   billable and one not) and Accessories (the seed has them).

| AC | Steps | Expected |
|---|---|---|
| 1 | As the OE open the task → *Simulate technician (dev only)* → *Start work*, *Submit* on fitment 1. Click *Photos (5)* | The fitment is Submitted; the viewer shows 5 labelled sample photos grouped Before, Asset, Cluster reading, Device/SIM placement, After, each with the technician, IST time and GPS; a photo opens full screen with zoom and next/previous |
| 2 | Click *Verify* on fitment 1. Open each select. In Masters deactivate one issue observed and reopen the sheet | The sheet ("Verify TK-…") shows technician, OT remarks and photos on the left (stacked on phones) and the form on the right; the selects list only active values (the deactivated one is gone) |
| 3 | Choose a billable final issue, then a non-billable one | The badge next to *Final issue* reads **Billable: Yes**, then **Billable: No** |
| 4 | Click *Verify* with fields empty. Then fill only *Issue observed*, tick an accessory, type OE remarks → *Save draft*, close and reopen the sheet | Verify is refused with "Fill in Issue observed at site, Action taken, Final issue before verifying" and each field marked; after Save draft the entries are still there; nothing changed status |
| 5 | Fill the rest → *Verify*. Sign in as the OM, then as an RO, and open the task | Fitment is **OE verified**; its row shows "Final issue: …" and the billable badge for OM and RO; *View verification* (RO) shows all values read-only |
| 6 | As the OM in Masters → Final issues, flip the billable flag of the issue used in AC5. Reopen the task | The verified fitment still shows its original billable value; the master change didn't alter it |
| 7 | As the OE: *Photos* → *Replace* on the Before photo → choose an image, reason "Blurry" → *Replace photo*; turn on *Show history*. Then as the OM *Final approve* the fitment; sign in as the OE again → *Photos* | The new photo shows; the original is greyed with "Replaced by <OE> · time · Blurry"; after approval the OE sees no Replace/Remove (API answers 409); the OM still can (flagged post-approval in History) |
| 8 | As the OE on fitment 2 (simulate Start/Submit) → *Verify* → *Upload a debug image*: a JPEG/PNG; then a PDF; then a file over 10 MB; then a text file renamed to `.jpg` | The image appears under *Debug image* with upload progress; the PDF and the large file are refused in the browser ("Only JPEG, PNG or WebP images can be uploaded", "The image must be 10 MB or smaller"); the renamed text file is refused by the server with the same type message |
| 9 | Finish the task (verify/approve or close fitment 2). Open *Completed tasks* and *All tasks*; *Download* → *Fitments (CSV)* and *Fitments (Excel)*; also the task CSV | The **Billable** column shows billable / verified (e.g. "1 / 1"); the fitment export has one row per fitment with issue observed, action taken, accessories, final issue, Billable Yes/No/blank, verified and approved times; the task export has *Verified fitments* and *Billable fitments* |
| 10 | Repeat the sheet, viewer, lightbox (swipe, pinch) and lists at 360 px (DevTools device mode). Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e` | Sheet and viewer are full screen, no sideways scrolling; all commands pass |
