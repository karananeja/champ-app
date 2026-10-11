# F05 — Workflow Engine: Approvals, Edit Locks, Reopen, Faulty (FT) and History: Intent

| | |
|---|---|
| Status | **Approved by user on 2026-10-12** |
| Requirements | SRS §5, §6.4 (items 5, 7) · source doc: approval flow OT → OE → OM, edit rules, re-opened tasks, FT, history tab · Decisions D-011, D-012, D-014, D-027, D-033, D-065 |
| Depends on | F04 (complete) |

## Why
F04 creates and assigns work. F05 makes it move. Each fitment goes through the confirmed flow, from Assigned to OM approved, and every level can only change what it's allowed to. Reopens are recorded with a reason and counted against the right person. A faulty device moves only its own fitment to FT and creates a replacement. OMs get a history tab that shows where each task is and everything that happened to it.

## What will be built

**1. Fitment status flow (D-011)**

| From | Action | To | Who |
|---|---|---|---|
| Assigned / Reopened | Start work (current GPS required) | In progress | OT (or OE doing the fitment) |
| In progress | Submit | Submitted | OT |
| Assigned / In progress | Close: not done (close reason + comments) | Closed – not done | OT |
| Assigned / In progress | Mark device faulty (reason) | Moved to FT, plus a **replacement fitment** (Open, same task, linked to the original, D-012) | OT |
| Submitted | Verify / approve | OE verified | OE (web, and mobile "Approve visit" later) |
| OE verified | Final approve | OM approved | OM (single or bulk) |
| Submitted / OE verified / Closed – not done | Reopen (reason required) | Reopened | OE or OM (D-027) |

- **Edit locks:**
  - The OT can change their fitment data until the OE verifies it.
  - The OE can change it until the OM approves it.
  - An OM can correct it at any stage. Every change after approval is flagged in the history.
- The task's overall status is recalculated from its fitments (Open → Assigned → In progress → Completed).
- The technician's actual form (photos, checks, device scan) is built in the mobile app (F10). F05 provides the steps and rules underneath it.

**2. Web actions (OE / OM)**
- The task page shows each fitment's status, with the actions allowed for you: Verify, Final approve, Reopen and Assign (Assign is from F04).
- OM bulk **Final approve** for a selection of OE-verified fitments.
- The OE verification form fields (issue at site, action taken, accessories, final issue → billable, debug image) are added in **F06**. In F05, Verify is a confirmation step.

**3. Re-opened and Faulty views** (replacing the F04 placeholders)
- **Re-opened:** fitments that have been reopened, with how many times, the latest reason, who reopened them and their current status. Filters: technician, OE, customer, date.
- **Faulty:** fitments moved to FT, with the fault reason and the replacement fitment's id and status.
- **Reopen counts per technician and per OE** are stored, ready for analytics (F15).

**4. History tab (OM only, D-033)**
- **Stage timeline** for the task and each fitment: First stage (Open/Assigned) → Second stage (In progress/Submitted) → Verification stage (OE verified) → Final stage (OM approved). It shows timestamps, who acted, and reopen loops.
- **Raw data:** the full event log (time, person, action, from/to status, and the before/after values of every change). It's filterable and downloadable as CSV.

**5. Technician simulator (development only)**

The mobile app arrives in F09/F10. To let you test the technician steps now, the task page gets a **"Simulate technician"** panel: Start, Submit, Close not done, Mark faulty. It's visible only when the app runs in development mode, never in a production build (open point 1).

## Who can do what

| | SA | OM | OE | OT | RO |
|---|---|---|---|---|---|
| Start / submit / close / mark faulty | — | — | own fitments if doing the fitment | own fitments (mobile) | — |
| Verify (Submitted → OE verified) | — | — | own tasks | — | — |
| Final approve | ✅ | ✅ | — | — | — |
| Reopen | ✅ | ✅ | own tasks | — | — |
| Re-opened / Faulty views | ✅ | ✅ | own tasks | — | ✅ |
| History tab and raw data | ✅ | ✅ | — | — | — |

## Out of scope for F05
- OE verification fields and image correction (F06).
- Kanban (F07). Travel tasks (F08). The mobile app (F09+). Notifications (F13).

## Acceptance criteria (UAT)
1. Using the simulator, a fitment goes Assigned → In progress → Submitted. The OE verifies it, the OM final-approves it, and when all its fitments are done the task shows Completed.
2. Steps out of order are refused with a clear message, for example final-approving a fitment that isn't OE-verified.
3. After the OE verifies, the technician can no longer change the fitment. After the OM approves, the OE can't either. The OM still can, and the change is flagged in history.
4. The OE reopens a submitted fitment with a reason. It appears in Re-opened with count 1, and the technician's reopen count goes up. A reopen without a reason is refused.
5. Marking a fitment faulty moves it to FT. A new Open fitment appears in the same task, linked to it, and the OE can assign it. Both show in the Faulty view.
6. Closing a fitment as not done needs a close reason. An OE can reopen it.
7. The OM sees the History tab with the stage timeline and raw events (including before/after values) and can download it. OE and RO don't see the tab.
8. OM bulk final-approve works for several OE-verified fitments.
9. The simulator panel doesn't appear in a production build.
10. Works at 360 px. Automated tests pass.

## Open points for this feature
1. **Testing technician steps before the mobile app exists:** is the development-only "Simulate technician" panel OK? The alternative is waiting until F10 to test those steps.
2. **Who a reopen counts against:** an OE reopening counts against the **technician**. An OM reopening an OE-verified fitment counts against **both the OE and the technician**. OK?
3. **After a reopen:** the fitment goes back to the **same technician** as "Reopened", they redo it, and the OE can reassign it if needed. OK?
4. **Closed – not done:** this is final unless an OE or OM reopens it. There's no separate OE approval step for it. OK?
