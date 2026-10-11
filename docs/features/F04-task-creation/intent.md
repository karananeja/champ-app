# F04 — Task Creation, CSV Bulk Upload and Task Views: Intent

| | |
|---|---|
| Status | **Approved by user on 2026-10-11** |
| Requirements | SRS §4, §6.4 (items 1–3, 5 delete) · source doc "Create task form fields", "Bulk upload", "Open task dashboard", "Task can only be deleted…" · Decisions D-009, D-011, D-052 |
| Depends on | F02, F03 (complete) |

## Why
Tasks are the core of Champ. F04 lets OM and OE turn a client requirement into work. It splits that work into one independent fitment per vehicle (D-009), so a single faulty device later moves only its own fitment to FT. F04 also adds the task lists everyone works from. The workflow actions (submit, verify, approve, reopen, move to FT) come in F05. F04 only creates and assigns.

## What will be built

**1. Create task form (web)**

All the fields from your doc, in sections:

| Section | Fields |
|---|---|
| Customer | Customer (select), **Site** (select, from the client's sites: D-052), Customer POC name, number and email (prefilled from the client's contact, editable) |
| Assignment | Operation executive (select; **frozen to yourself if you're an OE**), Technician type (radio: Payroll / Third party / Contractual), Technician (select, filtered by type; **optional**: see open point 3) |
| Asset and device | Asset type, Activity (filtered by asset type), Device type (defaults to LAF5), Vehicle make/model (**Vehicle assets only**), Installation type (GPS / GPS+CAN) |
| Schedule | Requested fitment date and time, Fitment date and time, Shift type (radio: Day / Night / Early morning) |
| Vehicles | Vehicle list entry (radio): **Enter number of vehicles** (N), or **Upload CSV** (one row per vehicle, with a sample to download) |
| Other | Issue reported by client (select), GPS address (optional), Comments (optional) |

- **Fitment location** is filled from the chosen site's city and isn't picked separately (open point 1).
- Dropdowns only offer active values (this also finishes F03 check 6).

**2. Auto-split and IDs**
- Saving creates a task with an **OM task id** (`OM-00001`) and an **OE task id** (`OE-00001`). It also creates **one fitment per vehicle**, each with a **technician task id** (`TK-00001`).
- If a technician was chosen, every fitment is **Assigned** to them. Otherwise fitments are **Open**.
- On the task page, the OE (or OM) can **assign or reassign each fitment** to any technician, while the fitment is still Open or Assigned.

**3. Bulk task upload (CSV)**
- "Bulk upload" includes a **Download sample CSV** button. The sample has every create-form field as a column, using readable names (customer code or name, site name, activity name, and so on) and a vehicle count.
- After upload you see a **preview**: valid rows in green, and invalid rows with the reason for each cell. **Import** creates only the valid rows; you can download the error rows as a CSV to fix and re-upload.
- One row = one task. Vehicles per row come from the count column; vehicle details are filled later.

**4. Task views (tables)**
- **Open tasks:** every task that isn't finished, with filters (customer, OE, technician, status, activity, date range) and search by task ids. Columns include ids, customer, site, activity, vehicles, assigned/total fitments, fitment date and status.
- **Assigned:** for OEs, the tasks assigned to them.
- **Travel, Faulty and Re-opened:** menu entries and empty pages appear now and fill in with F08/F05.
- **Download** any view as CSV or Excel (current filters applied).
- **Task detail page:** all task fields plus the fitment list (id, vehicle details, technician, status), with assign/reassign actions.
- Tables become cards on phones.

**5. Edit and delete**
- **Edit:** the task's creator, its OE or any OM can edit task fields while no fitment has started.
- **Delete:** **OM (and SA) only**, and only if no action has been taken. That means every fitment is still Open or Assigned and nobody has started work. The delete is recorded in the audit log.

## Who can do what

| | SA | OM | OE | RO | OT |
|---|---|---|---|---|---|
| Create task / bulk upload | ✅ | ✅ | ✅ (self as OE) | — | — |
| View task lists and detail | ✅ | ✅ | ✅ | ✅ | — (mobile, F09) |
| Assign or reassign fitments | ✅ | ✅ | own tasks | — | — |
| Edit (before work starts) | ✅ | ✅ | own tasks | — | — |
| Delete (no action taken) | ✅ | ✅ | — | — | — |

## Out of scope for F04
- Status changes beyond Open and Assigned, approvals, reopen, FT, history tab (F05).
- Kanban (F07). Travel tasks (F08). Mobile (F09+).
- Global search bar (F14). F04 has search inside the task lists only.

## Acceptance criteria (UAT)
1. An OM creates a task for 5 vehicles with a technician. The task gets OM and OE ids and shows 5 fitments with TK ids, all Assigned to that technician.
2. Without a technician, the fitments are Open. Assigning one of them to technician A and another to technician B works.
3. As an OE, the Operation executive field is locked to you.
4. Choosing a Battery asset hides vehicle make/model. The activities list only shows activities for the chosen asset type. Only active clients, sites and values are offered.
5. Choosing a client prefills the POC fields, and only that client's active sites can be picked.
6. "Upload CSV" for vehicles creates one fitment per row, with the vehicle details from the file.
7. Bulk upload: the sample downloads. A file with 3 good rows and 2 bad rows shows the 2 errors in the preview and imports 3 tasks. The error rows download as a CSV.
8. The Open tasks filters and id search work. Download gives CSV and Excel files with the filtered rows.
9. An OE sees their tasks under Assigned.
10. An OM can delete an untouched task. An OE gets no delete option. Editing works before work starts.
11. RO users see the lists and details with no create, edit, assign or delete actions.
12. Works at 360 px. Automated tests pass.

## Open points for this feature
1. **Fitment location:** your form has "Fitment location — Select" (a city). Since each client site already has a city, I'll fill it automatically from the site. Is that OK, or should it stay a separate choice?
2. **Vehicle CSV columns:** I'll use registration number, chassis number, asset number and old device id, all optional. The technician fills in or corrects them on site. Are there other columns, or ones that must be required?
3. **Technician at creation:** I've made it optional, because an OM creating work for an OE may not know the technician yet. If chosen, it applies to all fitments, and the OE can change individual ones. OK?
4. **Bulk upload:** one CSV row per task, with a vehicle count. OK, or do you need a format with one row per vehicle?
