# F10B — Test Report

| | |
|---|---|
| Date | 2026-10-12 |
| Branch | `feature/F10B-fitment-form` |
| Environment | macOS, Node 24, pnpm 10, Docker (postgres:16-alpine, MinIO), Chromium (Playwright), Xcode 26.6 (iPhone 17 simulator), Android emulator Pixel_10_Pro |
| Result | **All gates pass**: typecheck, lint, 1,068 unit/integration tests, 69 E2E tests (4 skipped by design), build with bundle check, expo-doctor, export for both platforms, **new native builds for iOS and Android**, and an end-to-end API flow on an isolated API |

## 1. Agent timing (D-127): three parallel agents

| Agent | Wall time | Debugging | Notes |
|---|---|---|---|
| Backend (shared, API, web) | **~18.5 min** | ~2 min | Shared contracts committed ~1.5 min in; full E2E took 5.2 min of it |
| Mobile-Form | **~8 min** | ~2 min | Coded against the §6.1 component contracts with mocks |
| Mobile-Capture | **~9 min** | ~2 min | Dependencies committed first |

The feature took ~19 min of wall time from launch to the last agent's finish. Claude's verification took ~25 min: native builds, gates, the API flow and docs.

## 2. Definition of done

| Step | Result |
|---|---|
| Migration | `20261012700000_fitment_form` applied to the dev DB. **Additive only**: `DeviceReplacement` enum; Fitment `deviceId`, `secondaryDeviceId`, `clusterReadingKm`, `deviceReplacement`, `checks`, `formUpdatedAt` |
| New dependencies (mobile) | expo-camera 57.0.6, expo-image-picker 57.0.20, expo-image-manipulator 57.0.21, expo-file-system 57.0.7, @shopify/react-native-skia 2.6.2, expo-text-extractor 2.0.0; Skia allowed in pnpm `onlyBuiltDependencies` |
| Native iOS build | prebuild + `expo run:ios`: **Build Succeeded**. Info.plist has camera, photo-library and location strings |
| Native Android build | prebuild + `expo run:android`: **BUILD SUCCESSFUL**. Manifest has CAMERA; RECORD_AUDIO is removed |
| expo-doctor / export | 21/21; iOS 5.7 MB and Android 5.9 MB bundles |

## 3. Quality gates

| Command | Result |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm test` | exit 0: **1,068 passed / 0 failed** (shared 411, api 357, web 195, mobile 105) |
| `pnpm test:e2e` | exit 0: **69 passed / 4 skipped** (the workflow and verification specs pass with the simulator filling the form) |
| `pnpm build` | exit 0; "Bundle check: no dev simulator in dist" |

| Suite | Before (F10) | After |
|---|---|---|
| `packages/shared` | 392 | **411** (`missingForSubmit` / `requiredPhotoKinds` truth tables, schema) |
| `apps/api` | 345 | **357** (`test/fitment-form.test.ts`; 29 existing tests now fill the form via `fillSubmitReady` before SUBMIT) |
| `apps/web` | 194 | **195** (Technician's form section) |
| `apps/mobile` | 62 | **105** (form 12, summary 3, wiring 3, pipeline 9, text candidates 3, PhotoSlot 8, ScanField 8; the continue placeholder was removed) |

## 4. End-to-end API flow (Claude, isolated API on :4200 with a throwaway `_e2e` database)

| Step | Result |
|---|---|
| Form PUT before Start | 409 `FITMENT_LOCKED` |
| SUBMIT with an empty form | 400 `FORM_INCOMPLETE`: Before photo, Asset photo, Cluster reading photo, the five checks, Vehicle registration no., Cluster reading (km), Device replacement, Device id, After photo |
| Form PUT (checks, reg no., 45,210 km, SIM, " lAf5-00123 ") | 200; device id stored as `LAF5-00123` |
| Upload before/asset/cluster/after (real JPEGs with lat/lng/takenAt) | 201 each; GPS stored |
| SUBMIT without the placement photo | 400: only "SIM placement photo" missing |
| Placement upload, retake of the before photo, SUBMIT | 201, 201, 200 Submitted |
| Edit after submit (device id) | 200; history `FITMENT_FORM_UPDATED {"Device id": ["LAF5-00123","LAF5-00999"]}` |
| History | `PHOTO_REPLACED` ("Retaken by the technician"), `FITMENT_SUBMITTED` with a readable snapshot |
| OE verifies, then the technician edits | 200 OE verified; edit → 409 `FITMENT_LOCKED` |

## 5. Not verified by Claude: check in UAT
The native pieces run only on a device, and your Metro and session were active on the emulator and simulator, so I didn't drive them:
- **Photo stamping (Skia):** the stamp text renders on both platforms (font matching "Helvetica" / "sans-serif").
- **Text recognition (expo-text-extractor 2.0.0, built against SDK 54):** it compiled in both native builds, but it isn't tested at runtime on SDK 57. Vision OCR on the iOS Simulator can return nothing, which the app shows as "No id found".
- **Barcode/QR scanning:** needs a real camera, or the Android emulator's virtual camera.
- **Keyboard padding with the sticky footer:** the Comments field on Android.
- **Autosave:** "Not saved — retrying" and recovery when the API is stopped.

## 6. Known limitations
- The iOS Simulator has no camera: use *Choose from gallery* there.
- Online only (D-008): unsent photos retry only while the form screen is open.
- One photo per kind; no video.
- The checks list is fixed (D-180); per-activity configuration comes later.
- Presigned photo URLs last 10 minutes. A summary left open longer needs a pull to refresh before photos open.

## 7. UAT checklist (intent acceptance criteria)

**Before you start:**
- Pull, `pnpm install`, and use the new Champ Dev builds (already installed on the iPhone 17 simulator and the Pixel_10_Pro emulator).
- Run `pnpm dev` and `pnpm --filter @champ/mobile start`.
- Start a fitment as a technician (F10).

| # | Acceptance criterion | Manual steps | Expected |
|---|---|---|---|
| 1 | Form opens, pre-filled | *Yes, continue* | Sections in order; reg no./chassis from the task |
| 2 | Photos: capture or gallery, stamped, on the web | Take one photo (Android camera or a phone), pick one from the gallery; open the fitment on the web verification sheet | Each photo has the stamp bar (TK id · IST time · GPS); it appears on the web within seconds |
| 3 | Scan device ids | *Scan* a barcode/QR (Android virtual camera, or a phone); *Read text* on a printed id | The value is offered, can be corrected, and is saved |
| 4 | Placement follows the replacement | Choose Device, then SIM, then No | The label changes; it's required for Device/SIM and hidden for No |
| 5 | Submit says what's missing | *Submit* early, then complete and submit | List of missing items (tap scrolls to the item); then Submitted, the summary opens, the route moves on |
| 6 | Nothing lost | Fill half the form, close the app, reopen, *Open form* | Photos and answers are there |
| 7 | Summary and edit until verified | *Edit* from the summary and change the device id; then verify as the OE on the web and open the form again | The edit saves and shows in the web history; after verification the form is read-only |
| 8 | OE sees everything | Open the fitment's verification sheet on the web | "Technician's form" with checks (Not OK highlighted), readings, device ids, comments and times, next to the photos |
| 9 | Tests pass; new build installed | — | §3 green; §2 builds succeeded |
