# F08 — Travel Tasks (TT): Intent

| | |
|---|---|
| Status | **Approved by user on 2026-10-12** |
| Requirements | SRS §6.5 · source doc: TT used by technicians to visit a client to pick up a faulty device, replace a device or fix an issue, and to claim travel allowance for ad-hoc work; "OE can verify the TT basis on the information available from the OT added which helps in reimbursement"; Travel task fields (Location, Customer, Technician, Purpose of travel) · Decisions D-018 (reimbursement is calculated outside the system) |
| Depends on | F05/F06 (complete) |

## Why
Technicians travel for work that isn't a planned fitment: picking up a faulty device, replacing a device, fixing an issue, or an ad-hoc visit. That travel has to be recorded and checked by their OE so reimbursement can be processed. The money itself is calculated outside Champ (D-018). Champ's job is a trustworthy, verified record of each trip.

## What will be built

**1. Travel task record**

| Field | Type | Notes |
|---|---|---|
| Travel task id | Auto | `TT-00001` |
| Technician | Select | Active technicians. Fixed to yourself when a technician raises it |
| Location | Select | Locations master (city) |
| Customer | Select | Active clients. **Optional** (open point 3) |
| Purpose of travel | Text area | Required |
| Travel date | Date picker | Required; can't be in the future (open point 1) |
| Related task / fitment | Select | Optional link to a TK id, e.g. the faulty device being picked up (open point 1) |
| Distance (km) | Number | Optional, as reported by the technician (open point 1) |
| Receipts / photos | Upload | Optional tickets or bills, using the F06 photo storage (open point 1) |

**2. Raising a TT**
- **On the web:** an OE (for their own technicians) or an OM/SA uses **Raise travel task** to record a trip on a technician's behalf.
- **In the mobile app:** technicians raise their own TTs. The screen comes in F09/F10, but the server side is built now, so the mobile app just plugs in.

**3. Verification (open point 2)**
- Flow: **Raised → Verified**, or **Raised → Rejected** (a reason is required).
- Who verifies: the **technician's reporting OE** or any **OM** (open point 4).
- A rejected TT can be corrected and **resubmitted** by whoever raised it. It goes back to Raised and the rejection stays in its history.
- A verified TT is locked. An OM can reopen it with a reason if a mistake is found.
- Every change is recorded in the TT's history, like fitments.

**4. Travel tasks view** (replaces the F04 placeholder)
- A table, or cards on phones, with filters: technician, OE, customer, location, status, travel date range (shadcn picker), and search by TT id.
- **Export** to CSV or Excel, for the team that calculates reimbursement.
- A detail panel showing every field, receipts in the photo viewer, the history, and the Verify / Reject / Reopen actions.
- Dashboard: OEs get a "Travel to verify" stat card, and the CR-03 empty-state illustrations are used throughout.

## Who can do what

| | SA | OM | OE | OT | RO |
|---|---|---|---|---|---|
| Raise TT | ✅ any tech | ✅ any tech | ✅ own technicians | ✅ self (mobile, F09+) | — |
| Edit / resubmit (while Raised or Rejected) | the person who raised it, OM | | | | |
| Verify / reject | — | ✅ | ✅ own technicians | — | — |
| Reopen a verified TT | — | ✅ | — | — | — |
| View travel tasks and export | ✅ | ✅ | own technicians | own (mobile) | ✅ |

## Out of scope for F08
- Any money calculation (D-018).
- Automatic distance from GPS (the daily route distance arrives with F10/F12).
- The technician's mobile screens (F09/F10).

## Acceptance criteria (UAT)
1. As an OE, raise a TT for one of your technicians with all the fields, including a receipt image. It appears in Travel tasks as `TT-00001`, status Raised.
2. An OE can only pick their own technicians. An OM can pick any technician.
3. Travel date can't be in the future. Purpose is required. Customer, related task, distance and receipts are optional.
4. The technician's OE (or an OM) verifies it, and it locks. Rejecting needs a reason. The person who raised it can then edit and resubmit, and the rejection stays in history.
5. An OM can reopen a verified TT with a reason.
6. Filters, date range and TT id search work. Export gives CSV and Excel with every field and the status.
7. RO users see travel tasks read-only. An OE sees only their own technicians' TTs.
8. The OE dashboard shows the "Travel to verify" count, linking to the filtered list.
9. Works at 360 px. Automated tests pass.

## Open points for this feature
1. **Extra fields:** your form lists Location, Customer, Technician and Purpose. For verifying reimbursement I've added **travel date** (required), plus **related task**, **distance (km)** and **receipts**, all optional. Add or remove any? For example: mode of transport, or from/to places.
2. **Statuses:** Raised → Verified or Rejected, with resubmit after rejection and OM reopen after verification. OK?
3. **Customer optional?** Some travel isn't for a client, such as a warehouse pick-up. OK to make it optional?
4. **Who verifies:** the technician's reporting OE, or any OM. OK?
