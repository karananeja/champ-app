# CR-11 — Actions on faulty (FT) fitments: assign the replacement, undo a mistaken "faulty"

| | |
|---|---|
| Raised | 2026-10-12 by the user, during F14 |
| Status | In progress |
| Branch | `feature/F14-global-search` (accepted together with F14) |
| Affects | Shared workflow, API, web (Faulty view, task page) |

## User request
> "also why is faulty task read only?" → Claude explained D-011/D-012 and offered an *Assign replacement* action in the Faulty view and a way to undo a mistaken faulty. → "both options seem to be good for FT"

## Change
1. **Assign replacement** (web, D-256): each Faulty-view row whose replacement is Open or Assigned gets an *Assign replacement* action that opens the existing assign dialog for the replacement fitment (the same rules and `POST /tasks/:id/assign` as the task page). The row shows the replacement's TK id, status and technician.
2. **Undo faulty** (D-257): a new workflow action `UNDO_FAULTY` ("Undo faulty"):
   - **Who:** the task's OE, an OM or SA (as for reopen). A reason is required (same rules as the reopen reason).
   - **When:** the fitment is *Moved to FT* **and** its replacement hasn't been started (Open or Assigned). Otherwise 409 with the reason ("TK-00031 (the replacement) is already in progress").
   - **Effect, in one transaction:**
     - the fitment goes back to **Assigned** with the same technician (they start it again with a fresh GPS fix); `faultyAt` and the fault reason are cleared; the form and photos are kept;
     - the replacement becomes **Closed – not done** with the system close reason **"Faulty marked by mistake"** (a built-in Close reasons entry that can't be edited or deleted) and the undo reason as comments;
     - events: `FITMENT_FAULT_UNDONE` ("Fault undone", with the reason and the replacement's TK id) on the fitment, `FITMENT_CLOSED_NOT_DONE` on the replacement; the task status is recomputed;
     - notification (F13): the fitment's technician — "TK-00012 is back with you · fault marking undone by Ravi" (body: the reason); not the actor.
   - **Web:** *Undo faulty* in the Faulty-view row actions and in the task page's fitment action menu, with a reason dialog. Not offered on the board (the card can be reached from the task page).
3. The Faulty view keeps listing fitments that are still Moved to FT; an undone one leaves it.

## Acceptance criteria
1. In Faulty tasks, a row whose replacement isn't started offers *Assign replacement*; assigning it shows the technician and status on the row.
2. *Undo faulty* with a reason puts the fitment back to Assigned with its technician, closes the replacement as "Faulty marked by mistake", and both show it in the history; the technician is notified.
3. *Undo faulty* is refused once the replacement has been started, and for anyone but the task's OE, an OM or SA.
4. Automated tests pass.
