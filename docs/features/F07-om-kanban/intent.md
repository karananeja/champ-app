# F07 — OM Kanban Board: Intent

| | |
|---|---|
| Status | **Approved by user on 2026-10-12** |
| Requirements | SRS §6.4 item 6 · source doc: "OM should have kanban view of tasks so that they can move around the tasks based on the need or the tasks move automatically when the necessary actions are performed" · Decisions D-011, D-077 |
| Depends on | F05, F06 (complete) |

## Why
Tables are good for searching. An OM managing a whole operation needs to see at a glance where work is piling up: how many fitments are waiting for a technician, waiting for OE verification, or waiting for final approval. The OM also needs to move things along without opening every task.

## What will be built

**1. Board (web, OM and SA only)**
- A new **Board** page under Tasks, visible to OM and SA only.
- **One card per fitment** (open point 1). Each card shows:
  - the technician task id (TK) and its task (OM id)
  - customer and site city
  - activity
  - technician (or "Unassigned")
  - fitment date (IST)
  - small badges: reopen count, billable (once verified), replacement-of, simulated
- **Main columns**, following the confirmed flow (D-011): **Open → Assigned → In progress → Submitted → OE verified → OM approved**. Each column header shows a count.
- **Side lanes**, collapsible: **Reopened**, **Closed – not done**, **Moved to FT**.
- Clicking a card opens a quick-view panel with key details and photos (from F06), plus a link to the full task page.

**2. Moving cards (drag and drop)**

You can drag a card only where you are allowed to perform the matching action. The same rules and checks apply as for the buttons on the task page (F05):

| Drag | Action | What happens |
|---|---|---|
| Open → Assigned | Assign | A dialog asks for the technician |
| Assigned → Open | Unassign | Confirm |
| — | Reassign | From the card quick view ("Change technician"); see open point 4 |
| OE verified → OM approved | Final approve | Confirm (multi-select allowed) |
| Submitted / OE verified / Closed → Reopened | Reopen | Dialog asks for the reason |

- Steps that belong to other people can't be dragged. Start and Submit belong to the technician; Verify belongs to the OE and needs the verification form. When a card is picked up, the columns it can't move to are greyed out. Dropping it there anyway shows the reason.
- **Cards move by themselves** when others act. The board refreshes every 30 seconds and when you return to the tab. Instant updates come with notifications in F13.

**3. Filters and scale**
- Filters: customer, OE, technician, activity, fitment date range (shadcn picker), and a search by TK, OM or OE id.
- By default the board shows all unfinished fitments. Finished columns (OM approved, Closed – not done, Moved to FT) show only the **last 7 days** (open point 3).
- Each column loads 50 cards at a time, with a "Load more" button.
- Cards in a column are ordered by fitment date, soonest first (open point 2).

**4. Phones and keyboard**
- At 360 px, the board shows **one column at a time**, with a column picker and swipe between columns. Moving a card there uses a "Move to…" menu instead of dragging.
- Dragging also works with the keyboard (pick up with Space, move with the arrow keys, drop with Space), for accessibility.

## Who can do what

| | SA | OM | OE | RO | OT |
|---|---|---|---|---|---|
| See the board | ✅ | ✅ | — | — | — |
| Assign, reassign, unassign, approve, reopen from the board | ✅ | ✅ | — | — | — |

## Out of scope for F07
- Real-time push (F13). Manual priority or ordering of cards. OE and technician boards. A task-level board (see open point 1).

## Acceptance criteria (UAT)
1. As an OM, Tasks → Board shows fitments in the 6 columns plus the 3 side lanes, with correct counts. OE, RO and OT users don't see the page.
2. Dragging an Open card to Assigned asks for a technician. After choosing one, the card lands in Assigned and the task page agrees.
3. Dragging OE verified → OM approved final-approves the fitment. Several selected cards can be approved in one drag.
4. Dragging to Reopened asks for a reason and then moves the card. The reopen count badge goes up.
5. Columns the card can't move to are greyed out while dragging. A forbidden drop (e.g. Assigned → Submitted) is refused with the reason, and the card returns to its column.
6. When the simulator or the OE moves a fitment, the card moves on the OM's board within 30 seconds, or straight away on returning to the tab.
7. Filters and id search narrow the board. Finished columns show the last 7 days. "Load more" works.
8. Clicking a card opens the quick view, which links to the task.
9. At 360 px: one column at a time, swipe between columns, and the "Move to…" menu works. Keyboard dragging works on desktop.
10. Automated tests pass.

## Open points for this feature
1. **Card = fitment or task?** I recommend **one card per fitment**. Fitments are what actually move through the flow, and a 5-vehicle task may have fitments in different columns. The alternative is one card per task, placed by the task's overall status (Open / Assigned / In progress / Completed), which is simpler but can't be dragged meaningfully.
2. **Order within a column:** by fitment date, soonest first. Do you also want the OM to be able to **manually reorder or prioritise** cards ("move around the tasks based on the need")? That means a stored priority, which technicians would then see as their order. My default is **no**, since the route planner (F10) decides the technician's order.
3. **Finished columns** show the last 7 days by default (the date filter can widen it). OK?
4. **Reassign by drag:** add an optional "group by technician" toggle (swimlanes) so the OM can drag a card from one technician's lane to another's? My default is **no** for MVP. Reassign stays in the card's quick view via a "Change technician" action.
