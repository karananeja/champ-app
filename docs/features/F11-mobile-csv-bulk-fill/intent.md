# F11 — Mobile CSV Bulk Fill: Intent

| | |
|---|---|
| Status | **Approved** 2026-10-12 ("ok continue"; open points as proposed, D-201 – D-205) |
| Requirements | SRS §6.6.8 · source doc: "If the tasks assigned to OT has too many sub tasks then they can upload the task updates in csv file and the system parses that sheet and fills the task and asks for confirmation from OT, also this should be mobile first only than filling the sheet and uploading the sheet" · M14 · Decisions D-021 (CSV pre-fills the forms, the OT confirms before submitting), D-156 (strict order), D-180–D-184 (form rules) |
| Depends on | F10B (complete) |

## Why
One task can have many vehicles: a fleet depot with 30 trucks means 30 fitments at the same site. Filling 30 forms field by field on a phone is slow and error-prone. F11 lets the technician fill the details for all of them in one spreadsheet, upload it from the app, check the preview and confirm. Champ fills every form at once. The in-app form stays the main way ("mobile first"); the CSV is the shortcut for big tasks.

## What will be built

**1. Bulk fill for a task (open point 1)**
- On the fitment screen and the route timeline, a task with **two or more** of your fitments shows **Bulk fill (CSV)**.
- It opens a screen for that task listing your fitments with their progress (form filled? photos? submitted?).

**2. The sample CSV**
- *Download sample CSV* saves or shares a file (share sheet: Files, Drive, email, Sheets) **pre-filled with your fitments of that task**.
- One row per fitment: TK id, vehicle reg no. and chassis no. where known, and empty columns for the rest.

| Column | Values |
|---|---|
| `tk_id` | Required, identifies the fitment (pre-filled) |
| `vehicle_reg_no`, `chassis_no` | Text |
| `cluster_reading_km` | Whole number |
| `asset_condition`, `accessories`, `vehicle_battery_condition`, `cluster_meter_reading`, `can_voltage` | OK / Not OK / NA |
| `device_replacement` | Device / SIM / No |
| `device_id`, `secondary_device_id` | Text |
| `comments` | Text |

**3. Upload, preview, confirm (D-021)**
- *Upload CSV* picks the file from the phone (Files, Drive or a download). Champ checks every row and shows a **preview**:
  - **valid rows** in green, with the values that will be filled
  - **rows with problems** in red, with the reason per cell (unknown TK id, not your fitment, already verified, "Not OK" misspelt, and so on)
  - a count: "18 ready, 2 with problems"
- *Confirm* fills the valid rows only. Blank cells leave existing answers unchanged (open point 5).
- Each filled fitment's history records "Filled from CSV".

**4. Starting the fitments (open point 2)**
- The fitments of one task are at the same site. So *Confirm* also **starts** any of them that aren't started yet, using **one** GPS fix (still required, M7). The technician doesn't have to start 30 fitments one by one.
- This relaxes the one-at-a-time rule (D-156) for fitments of the same task only.

**5. Photos (open point 3)**
- The required photos stay per fitment (D-182), because a CSV can't carry photos.
- The bulk screen lists each fitment with its missing photos and a quick *Add photos* that goes through them in order (before → asset → … → after), so a technician can work down the line of trucks.

**6. Submit ready (open point 4)**
- *Submit ready* submits every fitment of the task whose form and photos are complete, in one go.
- Incomplete ones are listed with what's missing, and stay In progress.
- Each fitment can still be opened, corrected and submitted individually.

## Who can do what

| | SA | OM | OE | OT | RO |
|---|---|---|---|---|---|
| Bulk fill own fitments (app) | — | — | ✅ when assigned (D-158) | ✅ | — |

## Out of scope for F11
- Photos in the CSV, or ZIP uploads of photos.
- Uploading the technician's CSV from the web (the OE's F04 bulk upload creates tasks; it doesn't fill fitment forms).
- Excel (.xlsx) files: CSV only. Sheets, Excel and Numbers can all export CSV.
- Offline use (D-008).

## Acceptance criteria (UAT)
1. A task with 2+ of your fitments shows *Bulk fill (CSV)*; a single fitment doesn't.
2. *Download sample CSV* gives a file with one row per fitment, TK ids and known reg/chassis already filled.
3. Uploading a filled CSV shows the preview: valid rows, invalid rows with per-cell reasons, and the counts.
4. *Confirm* fills only the valid rows, starts the not-yet-started fitments with one GPS fix (refused without location), and blank cells don't erase existing answers.
5. The filled fitments show the values in their forms, and the history says "Filled from CSV".
6. The bulk screen shows the missing photos per fitment, and *Add photos* walks through them.
7. *Submit ready* submits all complete fitments and lists the incomplete ones with what's missing.
8. Works on Android and iOS. Automated tests pass.

## Open points for this feature
1. **Scope:** bulk fill per **task** (all your fitments in one task, at one site). OK, or should one CSV cover your whole day across tasks?
2. **Starting:** *Confirm* starts the task's not-yet-started fitments with one GPS fix, so they don't need starting one by one. This relaxes strict order (D-156) within a task only. OK?
3. **Photos:** still required for every fitment (before, asset, after, and so on). Or, for bulk tasks, should one set of before/after photos per task be enough?
4. **Submit ready:** submit every complete fitment of the task in one tap. OK?
5. **Blank cells:** keep what's already filled (filled cells overwrite). OK?
