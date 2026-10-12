# F07 — Technical Spec

Implements `intent.md` (approved 2026-10-12). Binding decisions: D-011, D-077, D-084–D-088, D-109–D-113, plus everything from F01–F06 and the CRs. Follow the existing structure and conventions, especially the shared workflow module, `modules/workflow` (engine, lists), `modules/tasks` (assign), the web task page (assign dialog, reopen dialog, photo viewer, status badges), the CR-03 components and the CR-04 pickers. Reuse; don't duplicate. No database migration should be needed. If you add an index for board queries, the migration must be additive.

## 1. Shared
`packages/shared/src/board.ts`:
- `BOARD_COLUMNS` = `['OPEN','ASSIGNED','IN_PROGRESS','SUBMITTED','OE_VERIFIED','OM_APPROVED']`.
- `BOARD_LANES` = `['REOPENED','CLOSED_NOT_DONE','MOVED_TO_FT']`.
- `FINISHED_STATUSES` = `['OM_APPROVED','CLOSED_NOT_DONE','MOVED_TO_FT']`.
- `boardMove(from: FitmentStatus, to: FitmentStatus): BoardMove | null`, where `BoardMove` is `{ kind: 'ASSIGN' | 'UNASSIGN' | 'APPROVE' | 'REOPEN' }`:
  - OPEN → ASSIGNED: ASSIGN.
  - ASSIGNED → OPEN: UNASSIGN.
  - OE_VERIFIED → OM_APPROVED: APPROVE.
  - SUBMITTED, OE_VERIFIED or CLOSED_NOT_DONE → REOPENED: REOPEN.
  - Anything else: null.
- `boardMoveRefusal(from, to)`: a human message for a null move, reusing the workflow messages where possible. For example, "Only the technician can start or submit work", "Verification is done by the OE from the task page", "Approved fitments can't be moved".
- `canUseBoard(user)`: SA or OM.

## 2. API (prefix `/api`, SA/OM only via `requireRole`)

| Method | Path | Notes |
|---|---|---|
| GET | `/board` | Query: `clientId, oeId, technicianId, activityId, from, to` (fitment date, IST days inclusive, as in F04), `q` (TK, OM or OE id; parse with the shared id helpers), `pageSize` (default 50, max 100). Returns `{ columns: Record<FitmentStatus, { count, items: BoardCard[], hasMore }> }` for all 9 statuses |
| GET | `/board/:status` | Same filters plus `page`. Returns `{ count, items, hasMore }` for one status (used by "Load more") |

- Excludes deleted tasks.
- **Finished window (D-111):** for FINISHED_STATUSES, when neither `from` nor `to` is given, include only fitments whose status timestamp (`approvedAt`, `closedAt`, `faultyAt`) is within the last 7 days. When a fitment-date range is given, apply it to every column and drop the 7-day window. Counts follow the same rules.
- **Order (D-110):** `task.fitmentAt asc`, then `tkNo asc`.
- **Efficiency:** use a `groupBy` for counts plus one `findMany` per status (or a single query) with the needed includes. Don't make per-card queries.
- `BoardCard` = `{ id, tkId, status, task: { id, omId, oeTaskId }, client: { id, name }, city, activity, technician: { id, name } | null, fitmentAt, reopenCount, billable, replacementOf: { id, tkId } | null, updatedAt }`.
- **Moves** reuse the existing endpoints (D-113). Don't add mutation routes:
  - ASSIGN / UNASSIGN: `POST /tasks/:taskId/assign`. For multi-select, group the fitments by task and call once per task.
  - APPROVE: `POST /fitments/approve` with `fitmentIds` (multi-select).
  - REOPEN: `POST /fitments/:fid/transitions` with `REOPEN` and `{ reason }`, one call per fitment (multi-select allowed, one reason for all).
- Permissions stay enforced server-side as today. OE, RO and OT get 403 on `/board*`.

## 3. Web
- **Navigation:** add "Board" in the Tasks group, for SA/OM only. The route `/tasks/board` is guarded by `canUseBoard` with the CR-03 403 page.
- **Libraries:** `@dnd-kit/core`, with a pointer sensor (small activation distance so clicks still open the quick view) and a keyboard sensor with announcements.
- **Layout (≥ md):**
  - A horizontally scrollable row of 6 main columns. A collapsible "Other" area holds the 3 side lanes, collapsed by default and showing counts.
  - Column headers have the status badge colour, a count and a "Load more" button at the bottom when `hasMore`.
  - Use skeletons while loading and an EmptyState per column ("Nothing here").
- **Card:** compact, showing TK id (bold), OM id, customer, city, activity, technician or "Unassigned", fitment date (IST) and badges (reopen ×N, Billable Yes/No, Replacement of TK-…). Add a checkbox for multi-select; Shift-click selects a range in the same column.
- **Dragging:**
  - Show a drag overlay. When dragging several selected cards, the overlay shows "3 fitments".
  - While dragging, columns where `boardMove(from, to)` is null get greyed out with `aria-disabled`.
  - On drop:
    - **ASSIGN:** open the existing assign dialog (technician combobox from `/tasks/options`).
    - **UNASSIGN:** confirm.
    - **APPROVE:** confirm.
    - **REOPEN:** open the existing reopen dialog (reason).
    - **Null move:** toast with `boardMoveRefusal`, and the card snaps back.
  - Apply optimistic updates with rollback on error. Show server error messages verbatim. Partial failures from bulk approve list the failed TK ids.
- **Refresh:** TanStack Query with `refetchInterval: 30_000` and `refetchOnWindowFocus`. Pause refetching while a drag or dialog is in progress.
- **Filters bar:** customer, OE, technician, activity, a DateRangePicker (CR-04) and id search. Use the CR-04 placeholder/aria-label pattern. Filters live in URL search params so the view can be shared and reloaded. Add a small note "Finished columns show the last 7 days" when no date range is set.
- **Quick view:** clicking a card opens a Sheet (full screen on mobile) with:
  - fitment summary, technician, verification summary (if any), and a photo strip using the F06 viewer
  - actions: Change technician (assign dialog, when allowed), Final approve, Reopen
  - a "Open task" link
  Reuse the task-page components.
- **Phones (< md):**
  - One column at a time, with a Select or segmented column picker showing counts.
  - Horizontal swipe between columns using CSS scroll-snap, kept in sync with the picker.
  - Instead of dragging, each card has a "Move to…" menu listing only the allowed targets, which opens the same dialogs.
- New files use kebab-case names.

## 4. Tests
- **Shared:** the full `boardMove` matrix (9×9) and the refusal messages; `canUseBoard`.
- **API:**
  - grouping and counts per status; ordering
  - filters (client, OE, technician, activity, q by each id type, date range)
  - the finished 7-day window (old approved fitment hidden; shown when a range covers it)
  - pagination via `/board/:status`; deleted tasks excluded
  - 403 for OE, RO and OT
  - query count stays constant as the number of cards grows (check with Prisma query logging or a simple timing-agnostic count of queries)
- **Web:**
  - columns render with counts
  - greyed-out targets while dragging (simulate via the dnd-kit test utilities or by calling the drop handler)
  - drop → the correct dialog per move kind; refused move → toast
  - multi-select approve calls the bulk endpoint
  - mobile "Move to…" menu lists only allowed targets
  - filters are written to the URL
- **E2E** (desktop: real drags with Playwright mouse down/move/up in steps, plus one keyboard drag; 360 px: the "Move to…" menu):
  - Open → Assigned with a technician
  - multi-select OE verified → OM approved
  - drag to Reopened with a reason
  - a forbidden drop snaps back with a message
  - a simulator action elsewhere is reflected after a refetch (trigger with page focus or a reload)
  - quick view opens and links to the task
  - non-OM gets the 403 page

## 5. Definition of done
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e` and `pnpm build` all pass (the bundle check too).
- README updated.
- `test-report.md` includes a UAT checklist covering all 10 acceptance criteria.
