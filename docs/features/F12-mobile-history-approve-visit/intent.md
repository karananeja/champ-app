# F12 — Mobile History, Distance and Approve Visit: Intent

| | |
|---|---|
| Status | **Approved** 2026-10-12 ("ok continue"; open points as proposed, D-216 – D-220) |
| Requirements | SRS §6.6.10 ("History: the day's timeline and distance (routed distance from task 1 to task n), with tabs Personal and Direct reportees") and §6.6.11 ("Approve visit: the OE approves submitted fitments") · M3, M15, M18 · Decisions D-014 (Approve visit = Submitted → OE verified), D-015 (distance = routed distance from task 1 to task n), D-029 (7 days back), D-098 (fields required to verify), D-158 (OEs doing fitments) |
| Depends on | F06 (verification), F10 (routing), F11 (complete) |

## Why
Two pieces of the field app are still placeholders. The home screen already counts **Approve visit** for an OE, but tapping it does nothing: an OE in the field has to go back to the web to verify a technician's work. And there is no way to look back at a day: what was done, when, and how far the technician travelled. The OE also wants to see the same for the technicians who report to them.

## What will be built

**1. History tab (everyone)**
- A new **History** tab next to Home, Route and Profile, using the same date chip (today and 7 days back).
- **Personal:** your day as a timeline, oldest first. Each fitment you worked shows TK id, customer, site, and its steps with IST times: Started, Submitted, Closed – not done (reason) or Moved to FT, and its current status. Between two fitments: the drive distance.
- **Distance for the day** at the top (open point 1), e.g. "42.6 km · 6 fitments".
- Tap a fitment → its summary (F10B).

**2. Direct reportees (OE only, open point 3)**
- A second tab **Direct reportees** lists the technicians who report to you, each with their fitment count and distance for that day.
- Tap one → their timeline (read-only), the same view as Personal.
- An OT sees only Personal (no tabs).

**3. Approve visit (OE only)**
- Tapping **Approve visit** on Home opens the list of fitments **waiting for your verification** on that date: Submitted fitments of your tasks (the same as the home count), with TK id, technician, customer, site and submit time.
- Tap one → a verification screen:
  - the technician's form and photos (read-only; tap a photo for full screen)
  - the verification fields as on the web (D-098): **issue observed, action taken, final issue** (required), accessories and OE remarks (optional)
  - **Verify**: Submitted → OE verified, same rules and history as the web (billable from the final issue, D-101)
  - **Reopen** with a reason sends it back to the technician (open point 4)
- After verifying, the next waiting fitment opens, until the list is empty.

## Who can do what

| | SA | OM | OE | OT | RO |
|---|---|---|---|---|---|
| History: Personal (app) | — | — | ✅ | ✅ | — |
| History: Direct reportees (app) | — | — | ✅ (own reportees) | — | — |
| Approve visit (app) | — | — | ✅ (own tasks) | — | — |

## Out of scope for F12
- Background GPS tracking: the distance is computed from the start positions, not tracked (D-015, open point 1).
- Replacing technician photos or uploading the debug image from the app: stays on the web verification sheet (open point 5).
- History for OM/SA in the app (they use the web).
- Notifications (F13).

## Acceptance criteria (UAT)
1. The History tab shows the chosen day's timeline with times per step and the drive distance between fitments; the day total is at the top.
2. Changing the date shows that day; tapping a fitment opens its summary.
3. An OE sees *Direct reportees* with each technician's count and distance, and can open their timeline. An OT has no such tab.
4. *Approve visit* lists the Submitted fitments of the OE's tasks for the date, matching the home count.
5. Verifying on the phone requires issue observed, action taken and final issue, moves the fitment to OE verified, and shows on the web (status, history, billable).
6. *Reopen* with a reason sends the fitment back to the technician.
7. Works on Android and iOS. Automated tests pass.

## Open points for this feature
1. **Distance:** the routed (OSRM) driving distance through the **start positions** of the day's fitments in the order they were started (task 1 → task n, D-015). It doesn't include the drive from home to the first site or back. Fitments at the same site add 0 km. If routing is unavailable, straight-line distance, marked "approx.". OK?
2. **Which fitments count:** every fitment you **started** that day (In progress, Submitted, verified, approved, or closed / moved to FT after starting). Fitments closed without starting appear in the timeline but add no distance. OK?
3. **Direct reportees:** an OE sees the technicians whose manager is that OE. OK, or should an OE also see technicians who worked on their tasks without reporting to them?
4. **Reopen in Approve visit:** offer *Reopen* (with reason) next to *Verify* on the phone, as on the web. OK?
5. **Photo replacement and debug image** stay web-only for now. OK?
