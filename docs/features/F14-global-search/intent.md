# F14 — Global Search: Intent

| | |
|---|---|
| Status | **Awaiting user sign-off** |
| Requirements | SRS §6.7 ("Global search over the configured identifiers: device id, technician/OE/OM task id, asset number, secondary device id, chassis no., old device id. The identifier list is maintained by SA.") · X7 (fixed list for MVP, admin-managed later) · F02 intent (search identifiers deferred to F14) |
| Depends on | F04 (tasks), F10B (device ids from the technician's form), F13 (complete) |

## Why
Most questions start with an id someone reads off a device, a vehicle or a call: "what happened with device LAF5-00123?", "where is OM-00045?", "chassis MA1…?". Today the user has to guess the right list and filter. Global search finds the task and the fitment from any of these identifiers in one box.

## What will be built

**1. The search box (web)**
- A search field in the top bar on every page, for everyone who can see tasks (SA, OM, OE, RO), with the shortcut **Ctrl/⌘ K**. On phones it's a search icon that opens a full-width search.
- Results appear as you type (after 3 characters, or any OM/OE/TK/TT id), grouped by task:
  - **OM-00045** · Zoomcar · Bengaluru depot · status
    - **TK-00112** · KA01AB1234 · *Device id* **LAF5-00123** · status
- Each result says **which identifier matched**, with the match highlighted. Up to 20 results, with "Show all results" opening a results page.
- Enter or click opens the task, with that fitment's verification sheet when relevant (the F13 `?fitment=` link). Arrow keys move through the results.

**2. What it searches (open point 1)**

| Identifier | Where it's stored | Match |
|---|---|---|
| OM id, OE task id, TK id | Task / fitment number | Exact number (`OM-00045`, `oe-45`, `TK 112`, or just `112` → all three kinds) |
| Travel task id | TT number | Exact (`TT-00004`) |
| Device id, secondary device id | Technician's form (F10B) | Contains, ignoring case, spaces and hyphens |
| Old device id | Task's vehicle list (F04) | Contains, as above |
| Chassis no., asset no. | Vehicle list / form | Contains, as above |
| Vehicle registration no. | Vehicle list / form | Contains, as above (**added**: not in the source list) |

**3. The identifier list (open point 2)**
- **Settings → Search identifiers** (SA only): the list above with an on/off switch and the order results are ranked in. Only the identifiers that are on are searched. The set of identifiers itself is fixed (adding a new kind of identifier needs a code change).

**4. Who sees what (open point 3)**
- Results follow the same rules as the task lists: SA, OM, OE and RO see every task; deleted tasks never show. Technicians don't use the web, and the app gets no search box in F14.

## Who can do what

| | SA | OM | OE | OT | RO |
|---|---|---|---|---|---|
| Search (web) | ✅ | ✅ | ✅ | — | ✅ |
| Turn identifiers on/off and order them | ✅ | — | — | — | — |

## Out of scope for F14
- Search in the mobile app.
- Searching names, customers, sites or free text (comments, remarks). The task lists already filter by client and site.
- Fuzzy matching (typos).

## Acceptance criteria (UAT)
1. Typing a device id (or part of it) in the top-bar search lists the fitment and its task, showing "Device id" as the match.
2. OM, OE, TK and TT ids find their item exactly, with or without the prefix and leading zeros.
3. Chassis no., asset no., old device id, secondary device id and reg no. are found, ignoring case, spaces and hyphens.
4. Enter or click opens the task (with the fitment's sheet when relevant); Ctrl/⌘ K focuses the search; it works on a phone.
5. An SA can switch an identifier off, and it's no longer searched; others can't see the setting.
6. Deleted tasks never appear. Automated tests pass.

## Open points for this feature
1. **Identifiers:** the source list plus **vehicle registration no.** and **travel task id**. OK?
2. **SA-managed list:** an on/off switch and ranking order per identifier (fixed set), rather than a fixed list in config. OK?
3. **Visibility:** everyone who sees the task lists sees every match (as the lists do today). OK, or should an OE only find their own tasks?
4. **Matching:** exact for the numbered ids; "contains" (case, spaces and hyphens ignored, at least 3 characters) for the rest. OK?
5. **Web only** for now; search in the app later. OK?
