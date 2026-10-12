# F10 — Route Planning and Starting a Fitment: Intent

| | |
|---|---|
| Status | **Awaiting user sign-off** |
| Requirements | SRS §6.6.2–6.6.4 and 6.6.7 · source doc M5 route planning, M6 sequential order, M7 start needs current location, M8 Continue or Close, M12 move to FT; "draw the route timeline… starting from the nearest location to the farthest"; "show the task one after another… in the order system decides"; close reasons "client is not available / device has some issue" · Decisions D-012 (FT creates a replacement), D-015 (OSRM order, OT follows it), D-029 (7 days back), D-077 (OT transitions), D-078 (OE doing fitments) |
| Depends on | F05, F09 (complete) |

## Proposed split (open point 1)
The original F10 covers route planning, starting, closing and marking faulty, plus the whole fitment form (photos with time/GPS stamps, per-activity checks, barcode/QR and text scanning) and submitting. That's about twice the size of F09. To keep each build near the 20-minute agent target (CR-06), I propose two features:

| | Scope |
|---|---|
| **F10 (this intent)** | Day route on a map with an ordered timeline, the fitment screen, **Start** (GPS required), **Continue or Close** (close with a reason), **Mark faulty** |
| **F10B (next)** | The fitment form (Continue = Yes): before/after, asset, cluster and placement photos, compressed and stamped with time and GPS; per-activity checks; reg no., chassis no., cluster reading; device replacement; device id and secondary device id with barcode/QR and text scan; comments; **Submit**; task summary |

F11–F15 keep their numbers.

## Why
A technician's day is a list of fitments at different customer sites. Champ should tell them the best order to visit them in (D-015). It should show the route on a map and let them work through it one fitment at a time. Starting a fitment records where they really were. If a fitment can't be done, they close it with a reason; if the device is faulty, they move it to FT so the OE gets a replacement (D-012).

## What will be built

**1. Day route (replaces F09's read-only Tasks list)**
- For the chosen date (today or up to 7 days back), Champ orders the technician's open fitments into the shortest route from their **current location**, or their **home location** if GPS isn't available (open point 2). It uses OpenStreetMap routing (OSRM).
- **Map:** the route line, numbered stops and "you are here".
- **Timeline** under the map: each stop's number, TK id, customer, site, status, and the distance and drive time from the previous stop.
- Finished fitments (submitted, closed or moved to FT) stay in the timeline, ticked and greyed. The route's distance counts only the open stops.
- If routing is unavailable, the order falls back to straight-line distance, with a notice.

**2. One at a time, in the system's order (open point 3)**
- Only the **next** open fitment can be started. The others show "Up next after TK-…".
- A fitment that's already in progress stays first until it's submitted, closed or moved to FT.
- *Recalculate route* re-orders the remaining stops from where the technician is now, for example after the OE adds a fitment mid-day.

**3. Fitment screen**
- Customer, site address and map pin, vehicle details, activity, asset type, installation type, fitment time (IST), status and the OE's name and phone (tap to call).
- **Directions:** opens the phone's maps app with directions to the site.

**4. Start (needs the current location, M7)**
- *Start* asks for location permission and takes a fresh GPS fix. **Without one, the fitment can't be started**; the home location isn't accepted.
- The start position and time are saved on the fitment (they already show in the web history).
- No distance check against the site in F10 (open point 4).

**5. Continue or Close (M8)**
- After *Start* the technician chooses:
  - **Yes, continue:** goes to the fitment form. That form comes in F10B, so until then a placeholder screen explains this.
  - **No, close:** pick a reason from the Close reasons master (for example "Client not available", "Device has some issue") and add comments. The fitment becomes *Closed – not done*.
- *Close* is also available before starting (status Assigned), in case the customer cancels in advance.

**6. Mark faulty (M12)**
- On an Assigned or In-progress fitment, *Mark faulty* with a reason moves it to FT. The existing workflow creates the replacement fitment, which the OE handles (D-012).

**7. OEs doing fitments (D-078, open point 5)**
- On the web, an OE can assign a fitment **to themselves**, and an OM can assign one to an OE. The OE then sees it on their route in the app and works it like a technician.

## Who can do what

| | SA | OM | OE | OT | RO |
|---|---|---|---|---|---|
| See own day route, start, close, mark faulty (app) | — | — | ✅ own fitments | ✅ own fitments | — |
| Assign a fitment to an OE (web) | ✅ | ✅ | ✅ to themselves | — | — |

## Out of scope for F10
- The fitment form, photos, scanning, submitting and the task summary (F10B).
- CSV bulk fill (F11).
- Day history timeline and distance covered, and the Approve visit screen (F12).
- Live notifications (F13).
- Background GPS tracking and offline use (MVP backlog).
- Turn-by-turn navigation inside Champ: the phone's maps app does this.

## Acceptance criteria (UAT)
1. With three or more fitments assigned for today at different sites, the app shows them on a map with the route line and numbered stops. The timeline lists them in that order with the distance and time between stops.
2. The order starts from the technician's current location. With location denied, it starts from home and says so.
3. Only the first open fitment can be started; the others say which fitment comes first.
4. *Start* needs location. With location denied or no GPS fix, it explains why and doesn't start. With location, the fitment becomes *In progress*, and the web history shows the start time and position.
5. After *Start*, *No, close* with a reason and comments makes the fitment *Closed – not done* (visible on the web with the reason). The next fitment can then be started.
6. *Yes, continue* opens the F10B placeholder; the fitment stays *In progress*.
7. *Mark faulty* with a reason moves the fitment to FT, and the OE sees the replacement fitment on the web.
8. *Recalculate route* re-orders the remaining stops from the current position. A past date (up to 7 days back) shows that day's route and can be worked.
9. An OE assigned a fitment on the web sees it in the app and can start and close it.
10. *Directions* opens the phone's maps app at the site. Automated tests pass.

## Open points for this feature
1. **Split:** F10 (route, start, close, faulty) now and F10B (form, photos, scanning, submit, summary) next, as above. OK?
2. **Route start point:** current location, falling back to home when GPS isn't available. The order is recalculated only when the technician taps *Recalculate route*, or when fitments are added or removed, so it doesn't jump around while they drive. OK?
3. **Strict order:** only the next fitment can be started. To skip one, the technician closes it with a reason. OK, or should the OE be able to let them skip?
4. **Start distance check:** F10 records where the technician started but doesn't block a start far from the site. Should Champ warn or block beyond some distance, for example 500 m?
5. **OEs doing fitments:** include it in F10 (an OE can assign to themselves; an OM can assign to an OE)?
