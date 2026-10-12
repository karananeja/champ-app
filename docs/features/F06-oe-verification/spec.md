# F06 — Technical Spec

Implements `intent.md` (approved 2026-10-12). Binding decisions: D-031, D-032, D-045, D-077, D-084–D-088 (kebab-case files, EmptyState and illustrations, date pickers), D-098–D-102, plus everything from F01–F05 and the CRs. Follow the existing structure and conventions, especially `modules/workflow` (engine, shared state machine), `modules/tasks`, the simulator, the F05 task page and history, and the CR-03 UI components. Reuse; don't duplicate.

## 1. Storage (D-102)
- `apps/api/src/lib/storage/` contains:
  - an interface `Storage { put(key, body, contentType); signedGetUrl(key, ttlSec); exists?(key) }`
  - `S3Storage` (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, `forcePathStyle: true`)
  - `MemoryStorage` for tests
- Choose the driver with env `STORAGE_DRIVER=s3|memory` (default `s3`). Tests use memory.
- New env `S3_PUBLIC_URL` (default `http://localhost:9000`), used as the endpoint when signing GET URLs so browsers can reach them.
- `ensureBucket()` runs at API start for the s3 driver. It creates the bucket if it's missing and keeps it **private** (no public policy).
- Presigned GET URLs have a TTL of 10 minutes.
- E2E uses the real MinIO with its own bucket `champ-e2e`, set in the E2E env.
- Object keys: `fitments/{fitmentId}/{photoId}.{ext}`.

## 2. Data model (additive migration)

```prisma
enum PhotoKind { BEFORE AFTER ASSET CLUSTER PLACEMENT DEBUG }
enum PhotoStatus { ACTIVE REPLACED REMOVED }
enum PhotoSource { OT OE OM SIMULATOR }

model FitmentPhoto {
  id            String      @id @default(cuid())
  fitmentId     String
  kind          PhotoKind
  objectKey     String      @unique
  contentType   String
  sizeBytes     Int
  width         Int?
  height        Int?
  originalName  String?
  takenAt       DateTime?
  lat           Float?
  lng           Float?
  uploadedById  String
  source        PhotoSource
  status        PhotoStatus @default(ACTIVE)
  replacedById  String?     @unique        // the photo that replaced this one
  changeReason  String?
  changedById   String?
  changedAt     DateTime?
  createdAt     DateTime    @default(now())
  @@index([fitmentId, status])
}

model FitmentAccessory {          // many-to-many with LookupItem(kind ACCESSORY)
  fitmentId   String
  accessoryId String
  @@id([fitmentId, accessoryId])
}
```

Additions to `Fitment`:
- `issueObservedId String?` (ISSUE_OBSERVED), `actionTakenId String?` (ACTION_TAKEN), `finalIssueId String?` (FINAL_ISSUE)
- `oeRemarks String?`, `otRemarks String?` (set by the technician on submit: F10, or the simulator)
- `billable Boolean?` (snapshot, D-101)
- `verificationUpdatedAt DateTime?`, `verificationUpdatedById String?`

New TaskEvent types: `FITMENT_VERIFICATION_SAVED`, `PHOTO_ADDED`, `PHOTO_REPLACED`, `PHOTO_REMOVED`. Data carries diffs, the reason, photo ids and the post-approval flag.

## 3. Rules (shared, next to `workflow.ts`)
- `VERIFICATION_REQUIRED = ['issueObservedId', 'actionTakenId', 'finalIssueId']` (D-098), and `missingVerificationFields(v)`.
- `canEditVerification(actor, ctx)`:
  - OE of the task: status ∈ {SUBMITTED, OE_VERIFIED}.
  - OM: status ∈ {SUBMITTED, OE_VERIFIED, OM_APPROVED}. OM_APPROVED is flagged as post-approval.
  - SA is view-only, as in the intent's table.
- `canManagePhotos(actor, ctx)` (replace, remove, upload debug):
  - OE of the task: status ∈ {SUBMITTED, OE_VERIFIED}.
  - OM: any of {SUBMITTED, OE_VERIFIED, OM_APPROVED}.
- Viewing photos and verification: every task viewer (SA, OM, OE, RO). OT access to its own fitment's photos arrives with the F10 mobile API.

## 4. API (prefix `/api`)

| Method | Path | Who | Notes |
|---|---|---|---|
| PUT | `/fitments/:fid/verification` | canEditVerification | Draft save: `{ issueObservedId?, actionTakenId?, accessoryIds?, oeRemarks?, finalIssueId? }`. Values may be null. References must be active and of the right kind; an unchanged inactive value is allowed. If the fitment is already verified or approved and `finalIssueId` changes, recompute `billable` from that final issue's current flag. Writes an event with the diff. Returns the verification DTO |
| POST | `/fitments/:fid/transitions` (VERIFY) | as F05 | VERIFY now optionally accepts the same verification fields, saved first in the same transaction. The engine then refuses with 400 `VERIFICATION_INCOMPLETE` (details list the missing fields with labels) if any required field is empty. On success it snapshots `billable` from the final issue |
| GET | `/fitments/:fid/photos` | task viewers | `?history=true` also returns REPLACED and REMOVED photos (SA, OM and the task's OE only). Each item has metadata, uploader name and a `url` (presigned). Ordered by kind (BEFORE, ASSET, CLUSTER, PLACEMENT, AFTER, DEBUG), then createdAt |
| POST | `/fitments/:fid/photos` | canManagePhotos | multipart `file` + `kind` (only `DEBUG` here; technician kinds come from the F10 mobile API) |
| POST | `/fitments/:fid/photos/:pid/replace` | canManagePhotos | multipart `file` + `reason` (3..300). The new photo has the same kind and becomes ACTIVE; the old one is REPLACED with `replacedById`. One transaction (upload first, then DB; if the DB write fails, best-effort cleanup of the object) |
| POST | `/fitments/:fid/photos/:pid/remove` | canManagePhotos | `{ reason }`, status REMOVED |

- **Upload validation:** ≤10 MB (multer limit gives 413 → friendly 400 `FILE_TOO_LARGE`). The magic-byte check with the `file-type` package accepts only JPEG, PNG and WebP; anything else → 400 `UNSUPPORTED_FILE`. Read width and height from the header (`image-size`, pure JS). Avoid native modules (D-041).
- **Task detail DTO:** each fitment adds `verification { issueObserved, actionTaken, accessories[], oeRemarks, otRemarks, finalIssue, billable, updatedAt, updatedBy }` (names resolved), `photoCounts { active, byKind }`, and flags `canEditVerification` and `canManagePhotos`.
- **Lists and export (CR-04 views):**
  - Task list items add `billableCount` and `verifiedCount`, shown as a "Billable" column ("3 / 5") in Completed and All tasks.
  - `/tasks/export` adds `level=task|fitment` (default task). Fitment level is one row per fitment: TK id, task ids, customer, site, technician, status, vehicle fields, issue observed, action taken, accessories (joined), final issue, billable (Yes/No/blank), verified at, approved at. The web Download menu gets "Fitments (CSV/Excel)".

## 5. Simulator (dev only)
- Simulated SUBMIT now also:
  - sets `otRemarks` to a sample sentence
  - stores 5 sample photos (BEFORE, ASSET, CLUSTER, PLACEMENT, AFTER) with `source: SIMULATOR`, `takenAt: now` and lat/lng from the site
- Sample images: small JPEGs (around 20–60 KB, clearly labelled "SAMPLE — BEFORE" and so on) committed under `apps/api/src/modules/dev/sample-photos/`. Generate them once with a script, or use simple images you create; don't fetch them from the internet at runtime.
- These files are only reachable through the simulator module, which isn't mounted in production.

## 6. Web
- **Task page, per fitment:**
  - A "Photos" button with a count, which opens the photo viewer.
  - A **Verify** button (replacing the F05 confirm dialog) that opens a **verification sheet**: a right-side Sheet on desktop, full screen on mobile, titled "Verify TK-00012".
    - Left column, stacked on mobile: technician info, OT remarks and a photo grid.
    - Right column: the form (issue observed, action taken, accessories as a checkbox grid, OE remarks, debug image upload with drag-and-drop and a picker, and final issue). A **live billable badge** sits next to the final issue.
    - Buttons: **Save draft** and **Verify**. Verify shows the missing required fields inline when incomplete.
    - In read-only mode (OM viewing, RO, after lock), the same sheet shows the values without inputs.
    - For verified fitments, the button changes to "View verification" or "Edit verification" according to the flags.
  - Verified fitments show the final issue and a billable badge inline in the fitment row or card.
- **Photo viewer:** thumbnail grid grouped by kind, opening a lightbox with zoom and next/previous (e.g. `yet-another-react-lightbox` with its zoom plugin; keyboard and touch friendly).
  - Each photo shows its kind, uploader, time (IST) and GPS if present.
  - Managers see **Replace** (file picker + reason dialog) and **Remove** (reason dialog) per photo.
  - A "Show history" toggle (SA, OM, OE) reveals replaced and removed photos, greyed out with a badge ("Replaced by Suraj · 12 Oct 10:40 · reason").
  - Uses the CR-03 EmptyState when there are no photos.
- **Uploads:** client-side checks for type and size before sending, with a progress indicator, and server error messages shown verbatim.
- **Signed URLs:** the photo query refetches on window focus and every ~8 minutes, so URLs don't expire while the page is open.
- **New files:** kebab-case names, and existing components reused (EmptyState, page header, pickers, badges).

## 7. Tests
- **Shared:** required-field helper; `canEditVerification` and `canManagePhotos` matrices.
- **API (MemoryStorage):**
  - draft save (partial fields, nulls, inactive references rejected, wrong kind rejected)
  - VERIFY incomplete → 400 with the missing fields; VERIFY with inline fields succeeds
  - billable snapshot: verify with a billable issue → true; flip the master flag → the fitment stays true; change the final issue after verify → recomputed
  - edit locks per role and status, including the post-approval flag on OM edits and an OE blocked after OM approval
  - photos: list ordering, history visibility per role, debug upload, technician kinds refused, oversize → 400, a fake-JPEG text file → 400, replace keeps the original as REPLACED and links it, remove with a reason, permissions after approval
  - events written; task detail flags; export at fitment level (CSV and xlsx columns)
  - simulator submit attaches 5 photos and remarks
  - `S3Storage` unit test with a mocked S3 client (key, content type, presign endpoint uses `S3_PUBLIC_URL`)
- **Web:** verification sheet (required-field errors, live billable badge, read-only mode); photo viewer (grouping, replace and remove dialogs, history toggle); upload validation; Download menu fitment option.
- **E2E** (desktop and 360 px, real MinIO with the `champ-e2e` bucket):
  - Simulator submit, then the OE opens Verify: sees photos and OT remarks, sees the incomplete error, fills the fields, sees "Billable: Yes", verifies.
  - The OE replaces a photo with a reason; history shows the original.
  - Debug image upload, and a rejected non-image.
  - The OM sees the verification read-only, then approves; the OE can no longer replace photos.
  - Completed view shows the Billable column; fitment-level export downloads.

## 8. Definition of done
- Additive migration applies on the dev DB.
- `ensureBucket` works against the running MinIO.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e` and `pnpm build` all pass (the bundle check still passes).
- README updated (new env vars, storage).
- `test-report.md` includes a UAT checklist covering all 10 acceptance criteria.
