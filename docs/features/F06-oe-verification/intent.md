# F06 — OE Verification Screen and Image Correction: Intent

| | |
|---|---|
| Status | **Approved by user on 2026-10-12** |
| Requirements | SRS §6.4 item 4 · source doc: OE "verify the task details entered by the OT", "Correct the images uploaded by OT", verification fields list, "OE can select the final issue … to decide if the activity performed on client asset is billable or not" · Decisions D-031, D-032, D-045 |
| Depends on | F05 (complete) |

## Why
The OE's verification is the business decision point. It records what was actually found and done at the client's asset, which accessories were fitted, and the **final issue**, which decides whether the work is **billable**. F05 made Verify a plain confirmation. F06 turns it into the real verification form, and adds photos, which OEs must be able to see and correct.

## What will be built

**1. Photo storage (foundation, also used by the mobile app in F10)**
- Photos are stored in the local file store (MinIO, which F01 set up but nothing used yet).
- Each photo belongs to a fitment and has a **kind**:
  - Before, After, Asset, Cluster reading and Device/SIM placement (taken by the technician in F10)
  - **Debug image** (uploaded by the OE)
- Each photo records who uploaded it, when, and the GPS position if known.
- Photos open in a viewer: a thumbnail grid, then full-screen with zoom and next/previous.
- Accepted formats: JPEG, PNG, WebP, up to 10 MB each.

**2. Verification form (on the task page, per fitment)**

For a **Submitted** fitment, the OE opens **Verify** and sees the technician's work alongside the form:

| Field | Type | Source |
|---|---|---|
| Issue observed at site | Select | Issues observed master (D-045) |
| Action taken | Select | Actions taken master |
| Accessories | Checkboxes | Accessories master |
| Remarks from OT | Read-only | Entered by the technician (F10, or the simulator for now) |
| Remarks from OE | Text area | |
| Debug image | Upload (one or more) | From the external platform, as a file (D-032) |
| **Final issue** | Select | Final issues master. Its billable flag sets **Billable: Yes/No**, shown live |

- **Save draft** keeps the entries without verifying. **Verify** saves and moves the fitment to OE verified. The required fields must be filled first (open point 1).
- The billable result is **saved with the fitment at verification time**. Changing a final issue's billable flag in Masters later doesn't change past fitments (open point 4).
- Edit locks from F05 apply:
  - The OE can correct the verification until the OM approves.
  - The OM can always correct, and a change after approval is flagged in history.
- Every change appears in the History tab, with before and after values.

**3. Image correction**
- On any technician photo, the OE (until OM approval) or the OM can **Replace** it with a corrected image, or **Remove** a wrong extra one, with a short reason.
- The original isn't deleted. It stays in the history, marked "replaced by OE on …" (open point 3).

**4. Read-only views**
- OM and read-only users see the verification details, billable result and photos on the task page.
- The Completed and All tasks lists and the export get **Final issue** and **Billable** columns, ready for the billing report in F15.

**5. Simulator update (dev only)**
- "Simulate technician → Submit" now attaches sample photos (Before, After, Asset and so on) and sample OT remarks. This lets you test verification and image correction before the mobile app exists.

## Who can do what

| | SA | OM | OE (own tasks) | RO | OT |
|---|---|---|---|---|---|
| Fill and save verification, Verify | — | — | ✅ (Submitted) | — | — |
| Correct verification after Verify | — | ✅ always | ✅ until OM approval | — | — |
| Upload debug image | — | ✅ | ✅ | — | — |
| Replace or remove technician photos | — | ✅ | ✅ until OM approval | — | — |
| View verification and photos | ✅ | ✅ | ✅ | ✅ | own (F10) |

## Out of scope for F06
- The technician's photo capture, compression and time/GPS stamping on the phone (F10). The billing report (F15). Kanban (F07). Travel tasks (F08).

## Acceptance criteria (UAT)
1. Using the simulator, submit a fitment. It now has sample photos and OT remarks, visible in the photo viewer.
2. As the OE, open Verify. The OT remarks and photos sit next to the form, and the master lists show only active values.
3. Choosing a billable final issue shows "Billable: Yes", and a non-billable one shows "No".
4. Verify is blocked until the required fields are filled. Save draft keeps partial entries.
5. After Verify, the fitment is OE verified, and the verification details and billable result show on the task page for the OM and read-only users.
6. Changing a final issue's billable flag in Masters afterwards doesn't change the already-verified fitment.
7. The OE replaces a technician photo with a reason. The new photo shows, the original is in history, and after OM approval the OE can't replace photos any more.
8. The OE uploads a debug image. Files that are too large or not images are rejected with a clear message.
9. Completed/All tasks and the export show Final issue and Billable.
10. Works at 360 px, including the photo viewer. Automated tests pass.

## Open points for this feature
1. **Required to verify:** issue observed, action taken and final issue are required. Accessories, OE remarks and the debug image are optional. OK?
2. **"Issue reported at site":** I'm using the *Issues observed* list for this, because the client's reported issue is already on the task (F04). OK?
3. **Image correction keeps the original** in history rather than deleting it, for audit. OK?
4. **Billable is fixed at verification time** from the final issue. Should an OM also be able to **override** billable yes/no on a fitment (with a reason), or is the final issue always the rule?
