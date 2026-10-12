# F10B — Fitment Form, Photos, Device Scan and Submit: Intent

| | |
|---|---|
| Status | **Awaiting user sign-off** |
| Requirements | SRS §6.6.4–6.6.6 and 6.6.9 · source doc "OT task fields" (Continue = Yes), M9 fitment form, M10 device-id scan, M11 before and after photos required, M16 task summary · Decisions D-011 (OT can edit until the OE verifies), D-023 (barcode/QR **and** text scan), D-100/D-102 (photo storage), D-154 (the F10 split) |
| Depends on | F06 (photos), F10 (complete) |

## Why
F10 lets a technician start a fitment, but *Yes, continue* only shows a placeholder. F10B is the actual job record: the photos and readings that prove the device was fitted correctly, the device id that links the vehicle to the GPS unit, and *Submit*, which hands the fitment to the OE for verification (F06). Without it no fitment can be completed from the app.

## What will be built

**1. The fitment form** (opens from *Yes, continue*, and from an In-progress fitment)

| Field | Type | Rule |
|---|---|---|
| Before photo | Capture or upload | **Required** (M11) |
| Asset photo | Capture or upload | Required |
| Cluster reading photo | Capture or upload | Required for vehicle assets (open point 3) |
| Per-activity checks: Asset condition, Accessories, Vehicle battery condition, Cluster meter reading, CAN voltage | OK / Not OK / Not applicable | Each needs an answer (open point 1) |
| Vehicle registration no. | Text | Pre-filled from the task when known; required for vehicle assets |
| Chassis no. | Text | Pre-filled when known; optional |
| Cluster meter reading | Number (km) | Required for vehicle assets |
| Device replacement | Device / SIM / No | Required |
| Device id | Text, with **Scan** | Required (open point 4) |
| Secondary device id | Text, with **Scan** | Optional |
| Device or SIM placement photo | Capture or upload | Required when the replacement is Device or SIM; the label follows the choice |
| After photo | Capture or upload | **Required** (M11) |
| Comments | Text area | Optional |

- The form saves as you go: each photo uploads as soon as it's taken, and the fields save when you leave them. A dropped connection or a closed app doesn't lose work.
- *Submit* checks everything and points to whatever is missing. The fitment then becomes **Submitted** and is waiting for the OE (F06).

**2. Photos**
- Each photo is either taken with the camera or picked from the gallery (the source doc's "Upload or Capture").
- Every photo is **compressed** (about 1600 px on the long side, roughly 300–600 KB) and **stamped** in the corner with the date and time (IST), the GPS position and the TK id, burned into the image (open point 2).
- Photos go to the same private storage as F06, so the OE sees them on the web verification screen straight away. Retaking replaces the old photo, and the history keeps it (D-100).

**3. Device id scan (D-023)**
- *Scan* opens the camera. It reads a **barcode or QR code** if there is one, otherwise the **printed text** (on-device text recognition).
- The technician confirms or corrects the value before it's filled in.

**4. Submit and the task summary (M16)**
- After *Submit*, a summary screen shows every answer and photo, the start and submit times, and the fitment's status.
- The summary can be reopened from the route timeline.

**5. Editing until the OE verifies (D-011, open point 5)**
- While the fitment is Submitted, the technician can still correct the form: *Edit* from the summary.
- Once the OE verifies it, the form is read-only.

**6. Web**
- The OE's verification screen (F06) shows the technician's answers next to the photos: the checks, readings, device replacement, device ids and comments.
- The task history records *Submitted* with the form, and any later corrections as diffs.

## Who can do what

| | SA | OM | OE | OT | RO |
|---|---|---|---|---|---|
| Fill and submit the form (app) | — | — | ✅ when assigned (D-158) | ✅ own fitments | — |
| Edit after submitting, until verified | — | — | ✅ own | ✅ own | — |
| See the answers and photos (web) | ✅ | ✅ | ✅ | — | ✅ |

## Out of scope for F10B
- CSV bulk fill (F11).
- The day history timeline, distance and the Approve visit screen (F12).
- Offline queueing: the app is online only (D-008). Unsaved photos retry when the connection returns while the app is open.
- Video, or more than one photo per type.

## Acceptance criteria (UAT)
1. *Yes, continue* opens the form for an In-progress fitment. Fields already known from the task are pre-filled.
2. Each photo can be taken or picked from the gallery. It's stamped with time, GPS and TK id, and appears on the web verification screen within seconds.
3. *Scan* reads a barcode or QR code, and printed text when there's no code, into Device id and Secondary device id. The technician can correct the value.
4. The placement photo's label and requirement follow the Device replacement choice.
5. *Submit* refuses until the before and after photos and the required fields are there, and says what's missing. Then the fitment is Submitted and the route moves to the next stop.
6. Closing the app mid-form and reopening keeps the photos and answers.
7. The summary shows everything after submitting. *Edit* works until the OE verifies, and the edits show as diffs in the web history.
8. The OE sees all answers and photos on the web verification screen and can verify as before.
9. Automated tests pass. A new development build of the app is installed, because the camera, scanning and photo stamping need native modules.

## Open points for this feature
1. **Checks:** the source doc lists five per-activity checks. I propose the same five for every activity, each answered OK / Not OK / Not applicable. Making the list configurable per activity in Masters can come later. OK?
2. **Photo stamp:** burn the date/time, GPS and TK id into the image on the phone, so it survives downloads and exports. It needs a native image library and a new development build. The alternative is to store them alongside the photo and show them only as an overlay in Champ. Burn-in OK?
3. **Which photos are required:** before, after and asset always; cluster reading for vehicle assets; placement when the replacement is Device or SIM. OK?
4. **Device id required:** always, because it links the vehicle to the GPS unit. Should it be optional when the device replacement is *No*?
5. **Editing after submit:** allowed until the OE verifies, per D-011. OK?
