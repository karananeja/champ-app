# F10B — Technical Spec

Implements `intent.md` (approved 2026-10-12). Binding decisions: D-008, D-011, D-023, D-100, D-102, D-104, D-108, D-127, D-153, D-158, D-177/D-178 (keyboard padding), D-180–D-184, plus everything from F01–F10. Reuse, don't duplicate:
- the F06 storage lib and upload validation (`apps/api/src/modules/verification/upload.ts`, `photos.ts`: 10 MB, magic bytes, role check before multer reads the file, replace keeps history)
- the workflow engine (`SUBMIT` already exists; add the form check)
- the F10 mobile router, `GET /mobile/fitments/:fid`, the session/api client, theme, `Dialog`, toast and `lib/location.ts`

Three parallel agents (D-127):

| Agent | Owns |
|---|---|
| **Backend** | `packages/shared`, `apps/api`, `apps/web`: §1–§4, §7 |
| **Mobile-Form** | the form, summary and route wiring: §5 |
| **Mobile-Capture** | the native pieces (photo pipeline, `PhotoSlot`, `ScanField`, deps, app config): §6 |

The two mobile agents meet only at the component contracts in §6.1.

## 1. Data model (additive migration)

```prisma
enum DeviceReplacement { DEVICE SIM NONE }
model Fitment {
  // …existing (vehicleRegNo, chassisNo, otRemarks are reused for reg no., chassis no., comments)
  deviceId            String?             // 1..64
  secondaryDeviceId   String?             // 1..64
  clusterReadingKm    Int?                // 0..9,999,999
  deviceReplacement   DeviceReplacement?
  checks              Json?               // { assetCondition, accessories, batteryCondition, clusterMeter, canVoltage }: 'OK' | 'NOT_OK' | 'NA'
  formUpdatedAt       DateTime?
}
```

## 2. Shared (`packages/shared/src/fitment-form.ts`, exported). Backend commits it FIRST and reports it.

```ts
export const FITMENT_CHECKS = ['assetCondition', 'accessories', 'batteryCondition', 'clusterMeter', 'canVoltage'] as const;
export const CHECK_LABELS: Record<FitmentCheck, string>;   // 'Asset condition', 'Accessories', 'Vehicle battery condition', 'Cluster meter reading', 'CAN voltage'
export const CHECK_VALUES = ['OK', 'NOT_OK', 'NA'] as const;  // labels 'OK', 'Not OK', 'Not applicable'
export const DEVICE_REPLACEMENTS = ['DEVICE', 'SIM', 'NONE'] as const; // labels 'Device', 'SIM', 'No'

export const fitmentFormSchema = z.object({            // PUT body: every field optional (partial save); null clears
  vehicleRegNo, chassisNo (trim, ≤ 32), clusterReadingKm (int 0..9_999_999), deviceReplacement,
  deviceId, secondaryDeviceId (trim, 1..64, uppercase-normalised), checks (partial record of CHECK_VALUES), comments (≤ 1000)
});
export interface FitmentFormDto { /* the fields above, all nullable */ checks: Partial<Record<FitmentCheck, CheckValue>>; updatedAt: string | null }

export type RequiredPhotoKind = 'BEFORE' | 'AFTER' | 'ASSET' | 'CLUSTER' | 'PLACEMENT';
/** D-182: which photo kinds this fitment needs. */
export function requiredPhotoKinds(input: { isVehicle: boolean; deviceReplacement: DeviceReplacement | null }): RequiredPhotoKind[];
/** D-180/182/183: what is still missing before SUBMIT, as readable labels (e.g. 'Before photo', 'Device id', 'CAN voltage'). Empty = ready. */
export function missingForSubmit(form: FitmentFormDto, activePhotoKinds: PhotoKind[], ctx: { isVehicle: boolean }): string[];
export const PHOTO_SLOT_LABELS: Record<RequiredPhotoKind, string>; // PLACEMENT label depends on replacement: see placementLabel()
export function placementLabel(r: DeviceReplacement | null): string;  // 'Device placement photo' | 'SIM placement photo'
```

- **Required fields for submit:** all five checks, device replacement, and the device id. For vehicle assets (asset type code `VEHICLE`) also the vehicle reg no. and the cluster reading.
- `MyFitmentDto` (F10) gains `isVehicle: boolean`, `form: FitmentFormDto`, `photos: FitmentPhotoDto[]` (active technician photos, with presigned URLs), `startedAt`, `submittedAt`.
- New error code `FORM_INCOMPLETE` (400). Its body `details.missing` holds the labels.
- `uploadTechnicianPhotoSchema` (multipart fields): `kind` in `TECHNICIAN_PHOTO_KINDS`, `lat`, `lng` (both or neither), `takenAt` (ISO, not in the future + 5 min).

## 3. Rules
- **Who may edit (D-184):** the assigned technician (OT or OE, D-158) while the fitment is `IN_PROGRESS` or `SUBMITTED`. Anything else gets 409 `FITMENT_LOCKED`; reuse the existing code if there is one, else add it.
- **Saving the form:** `PUT` merges the partial form and sets `formUpdatedAt`.
  - While `IN_PROGRESS`, it writes no event (autosave would flood the history).
  - While `SUBMITTED`, each save that changes something writes `FITMENT_FORM_UPDATED` with a readable diff.
- **Photos:** one active photo per technician kind. A new upload of the same kind marks the old one `REPLACED` (`replacedBy`) and writes `PHOTO_REPLACED`; a first upload writes `PHOTO_ADDED`.
  - Same storage keys and validation as F06. The role and the fitment rule are checked before the file is read (D-108).
  - `takenAt`, `lat` and `lng` are stored on the photo.
- **SUBMIT:** inside the existing transaction, compute `missingForSubmit` from the stored form and the active photos. If anything is missing → 400 `FORM_INCOMPLETE` with the list. On success, `FITMENT_SUBMITTED` carries a snapshot of the form.
  - The dev simulator (D-073) must still submit: when it acts, it fills the required form fields with sample values (like its sample photos) before SUBMIT.
- **Web verification (F06):** the verification sheet shows a **Technician's form** section above the OE fields:
  - checks (Not OK highlighted)
  - reg no., chassis no., cluster reading
  - device replacement
  - device id and secondary device id
  - comments
  - start and submit times

  The history shows the form diffs.

## 4. API (prefix `/api`; OT/OE assigned technician only)

| Method | Path | Notes |
|---|---|---|
| GET | `/mobile/fitments/:fid` | Existing; now includes `form`, `photos`, `isVehicle`, `startedAt`, `submittedAt` |
| PUT | `/mobile/fitments/:fid/form` | Body `fitmentFormSchema`; returns `MyFitmentDto` |
| POST | `/mobile/fitments/:fid/photos` | Multipart `file` + `uploadTechnicianPhotoSchema`; returns `FitmentPhotoDto` (201) |
| POST | `/fitments/:fid/transitions` | `SUBMIT` now enforces §3 |

## 5. Mobile-Form agent (`apps/mobile`, JS only, no new dependencies)
- **Routes:** `/fitment/[id]/continue` becomes **the form** (keep the path, so F10's *Yes, continue* works). Add `/fitment/[id]/summary`.
- **Form screen** (sections in the source doc's order, with keyboard padding as D-177/178):
  1. `PhotoSlot` Before
  2. `PhotoSlot` Asset
  3. `PhotoSlot` Cluster (vehicles)
  4. Checks: five segmented controls (OK / Not OK / N/A)
  5. Reg no., chassis no. and cluster reading (numeric)
  6. Device replacement: segmented Device / SIM / No
  7. `ScanField` Device id and `ScanField` Secondary device id
  8. `PhotoSlot` Placement: shown when Device or SIM, labelled with `placementLabel`
  9. `PhotoSlot` After
  10. Comments
- **Autosave:**
  - Text fields save on blur. Segmented controls save on change.
  - Saves queue one at a time. A failed save shows "Not saved — retrying" and retries every 5 s while the screen is open.
  - Header status: "Saved" / "Saving…" / "Not saved".
- **Submit (sticky footer):**
  - Run `missingForSubmit` locally. Anything missing → a list dialog ("Still needed: Before photo, CAN voltage…") with each item scrolling to its section.
  - Otherwise `SUBMIT`. A server `FORM_INCOMPLETE` shows the same dialog.
  - Success → `/fitment/[id]/summary` (replace), then invalidate route, home and fitment.
- **Summary screen:**
  - status, start and submit times, every answer, photo thumbnails (tap → full screen), comments
  - *Edit* (status Submitted) → the form; when Verified or later: "Verified by your OE — read only"
  - *Back to route*
- **Wiring:**
  - Route timeline: tapping a stop that is Submitted or later opens the summary. The fitment screen shows *Open form* while In progress and *View summary* when Submitted or later.
  - Remove the placeholder screen and its test.
- **Tests:**
  - form: pre-fill, save on blur with the PUT body, segmented save, the placement slot follows the replacement, the missing-list dialog, submit success → summary, server `FORM_INCOMPLETE`
  - summary: fields, Edit only while Submitted
  - route/fitment wiring
  - Mock `PhotoSlot`/`ScanField` with `jest.mock('../components/photo-slot')` until the capture agent's real ones land; the tests must not depend on their internals.

## 6. Mobile-Capture agent (`apps/mobile`; owns new dependencies, `app.config.ts` and the lockfile)

**Dependencies** (`npx expo install`, exact versions, all SDK-57 compatible):
- `expo-camera`: capture and barcode/QR scanning (`CameraView`, `barcodeScannerSettings`)
- `expo-image-picker`: gallery
- `expo-image-manipulator`: resize and JPEG compress
- `@shopify/react-native-skia`: burn the stamp into the image off-screen, so nothing is shown on screen while stamping
- `expo-file-system`: temp files
- On-device text recognition: **`expo-text-extractor`** (Apple Vision on iOS, ML Kit on Android) if it exists and supports SDK 57 (`npm view`). Otherwise `@react-native-ml-kit/text-recognition`, and **report it**: it can fail on Apple-silicon iOS simulators.

No native builds (Claude builds). Add the camera and photo-library permission strings to `app.config.ts`.

### 6.1 Contracts (Mobile-Form codes against these exact props)

```tsx
// src/components/photo-slot.tsx
export function PhotoSlot(props: {
  fitmentId: string; tkId: string; kind: RequiredPhotoKind; label: string; required: boolean;
  photo: FitmentPhotoDto | null;            // the active one from MyFitmentDto.photos
  onUploaded: (photo: FitmentPhotoDto) => void;
  disabled?: boolean;                       // read-only (verified)
  testID?: string;
}): JSX.Element
// src/components/scan-field.tsx
export function ScanField(props: {
  label: string; value: string; onChange: (v: string) => void; onBlur?: () => void;
  required?: boolean; error?: string; disabled?: boolean; testID?: string;
}): JSX.Element   // a TextField with a "Scan" button
```

**`PhotoSlot`:**
- **Empty state:** the label, "Required", and *Take photo* / *Choose from gallery*.
- **Filled state:** a thumbnail (tap = full screen), *Retake*, and "Uploading… / Upload failed — Retry".
- **Pipeline** (`src/lib/photo-pipeline.ts`, pure functions where possible):
  1. capture or pick
  2. a GPS fix (balanced, 10 s; none → stamp "GPS unavailable")
  3. resize to 1600 px on the long side, JPEG q 0.7
  4. stamp with Skia: a semi-transparent bar at the bottom with `TK-00012 · 12 Oct 2026, 5:04 pm IST · 12.97570, 77.60500`
  5. write to a temp file
  6. upload multipart to `/mobile/fitments/:fid/photos` with `kind`, `lat`, `lng`, `takenAt`
  7. delete the temp file
- Retries keep the stamped file until the upload succeeds.
- The camera opens full screen in a modal (`CameraView`, rear camera, a shutter button, flash toggle).

**`ScanField`:**
- *Scan* opens a full-screen camera modal with barcode scanning (code128, code39, ean13, qr, datamatrix). The first code read is offered for confirmation.
- *Read text* takes a picture and runs text extraction. It lists the candidate lines (alphanumeric runs of 6+ characters, ranked longest first) to pick from.
- The chosen value goes into the field; the technician can edit it.
- Permission denied → an explanation with *Open settings*.

**Tests:**
- pipeline: resize and stamp called with the right text, upload body, retry keeps the file, no-GPS stamp
- PhotoSlot: states, retake
- ScanField: barcode result confirm, text candidates ranking and pick, denied permission
- Mock the native modules in `src/test/setup.ts`, extending the existing mocks; don't break the others.

## 7. Backend tests
API (Vitest + Supertest), covering:
- **Form saves:** PUT partial merge; the 409 lock after verify; another technician → 403; validation; no event while In progress; a diff event while Submitted.
- **Photo upload:** kinds; replace keeps history; refusal before parse; storage key; takenAt/lat/lng stored.
- **SUBMIT:**
  - `FORM_INCOMPLETE` for each missing kind of item (vehicle vs. non-vehicle, placement rule)
  - success with the snapshot event
  - the dev simulator still submits
- **`GET /mobile/fitments/:fid`:** includes form, photos and isVehicle.

Shared: `missingForSubmit` and `requiredPhotoKinds` truth tables. Web: the form section on the verification sheet (unit test). Existing E2E (workflow and verification specs) must still pass with the simulator change.

## 8. Definition of done
- **Backend:** migration applied to the dev DB; full gates once at the end (ignore failures that are only inside `apps/mobile` and say so).
- **Mobile agents:** `pnpm --filter @champ/mobile test`, typecheck, root lint, `expo-doctor`, `expo export` for both platforms. Mobile-Form may run these only after Mobile-Capture has committed. If Capture isn't done when Form finishes, Form reports its own suites green with mocks.
- Each agent reports its wall time, debugging minutes, proposed decisions (Backend D-185 onward; Mobile-Form F-1…; Mobile-Capture C-1…) and README notes. Claude writes the docs, makes the new development builds (iOS + Android) and smoke-tests on the emulator with an isolated API.
