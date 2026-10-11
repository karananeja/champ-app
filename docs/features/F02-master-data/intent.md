# F02 — Master Data and Technician Management: Intent

| | |
|---|---|
| Status | **Approved by user on 2026-10-11** |
| Requirements | SRS §3, §4, §6.2 · Decisions D-013, D-017, D-022, D-028 |
| Depends on | F01 (complete) |

## Why
Every task form, check and report draws on lists: customers' asset types, activities, make/models, locations, issues and so on. These need to exist, be editable without code changes, and start with dummy values (D-017) that you can swap for real ones later. Technicians also need their own profile data (type, base location) before tasks can be assigned to them.

## What will be built

**1. Masters admin (web, new "Masters" section)**

One consistent screen per master: a searchable table, add/edit dialog, and activate/deactivate. Records are deactivated, never deleted, so old tasks keep their values.

| Master | Fields | Seeded dummy values |
|---|---|---|
| Asset types | name | Battery, Vehicle (fixed: can't be deactivated) |
| Activities | name, asset type | e.g. Vehicle: New installation, Reinstallation, Removal, Device replacement, Health check. Battery: New installation, Removal, Device replacement |
| Device types | name | LAF5 (the only value, D-022) |
| Vehicle make/model | make, model | ~6 samples, e.g. Tata Ace, Ashok Leyland Dost |
| Installation types | name | GPS, GPS+CAN |
| States | name | Indian states and UTs |
| Regions | name | North, South, East, West, Central |
| Locations | city (input), state (select), region (select) | ~8 sample cities |
| Issues reported (by client) | name | 4–5 dummy values |
| Issues observed (at site) | name | 4–5 dummy values |
| Actions taken | name | 4–5 dummy values |
| Final issues | name, **billable yes/no** | 4–5 dummy values, mixed billable |
| Accessories | name | Relay, Buzzer, SOS button, CAN cable, … |
| Close reasons | name | Client not available, Device has some issue (from your doc) |
| Shift types | name | Day, Night, Early morning (fixed) |
| Task types | name | OT, TT, FT (built-in, can't be renamed or deactivated) plus custom names (D-013) |

**2. Technician management (web)**
- A **Technicians** page lists every OT with name, contact, email, type (Payroll, Third party, Contractual), base location, reporting OE and status.
- **Add technician** uses your form (name, contact number, email, type) plus a base location and a reporting OE. It creates the technician's invite and shows the same one-time link dialog as F01.
- OM, SA and OE can edit a technician's type, base location and contact details. An OE can only manage their own technicians.
- The technician's home location is **not** in this feature. The technician sets it on first login in the mobile app (F09).

**3. Shared lookup endpoint**

A single API endpoint returns all active master values. Every later form (tasks, verification, mobile) reads its dropdowns from it.

## Who can do what

| | SA | OM | OE | RO |
|---|---|---|---|---|
| View masters | ✅ | ✅ | ✅ | ✅ |
| Add/edit/deactivate masters (except task types) | ✅ | ✅ | — | — |
| Add/edit task types | ✅ | only with "Delegate task types" (from F01) | — | — |
| Add technician | ✅ | ✅ | ✅ (reports to them) | — |
| Edit technician | ✅ | ✅ | own technicians | — |

## Out of scope for F02
- Clients and the map picker (F03).
- Global search identifiers (F14).
- Home location (F09).
- Per-activity checklist configuration: checks are the same for every activity (D-028).

## Acceptance criteria (UAT)
1. A fresh seed shows every master in the table above with its dummy values.
2. An OM can add, edit and deactivate an item in any master. A deactivated item is hidden from the lookup endpoint but still listed (greyed out) in admin.
3. Built-in items (asset types, shift types, task types OT/TT/FT) can't be deactivated or renamed.
4. Duplicate names in the same master (and the same city in the same state) are rejected with a clear message.
5. An activity must belong to an asset type. Filtering activities by asset type works.
6. A final issue's billable flag can be toggled and shows in the table.
7. Task types: an OM without delegation sees them read-only. After SA delegates task types, that OM can add one.
8. Add technician creates an OT invite with type, base location and reporting OE. Accepting it gives an OT whose details show on the Technicians page.
9. An OE sees and edits only their own technicians. RO sees everything with no edit actions.
10. All screens work at 360 px. Automated tests pass.

## Open points for this feature
1. **"Activity form fields" in your doc** (Activity, Issue reported, Issue observed, Action taken, Final issue: all selects). I've read this as the OE verification step choosing from these global lists, with no per-activity mapping. Should certain issues or actions be allowed only for certain activities instead?
2. **Technician base location:** is it OK that each technician has one base location (city) from the Locations master, used for filtering and assignment?
