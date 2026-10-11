# CR-04 — Completed tasks view; shadcn date pickers instead of native inputs

| | |
|---|---|
| Raised | 2026-10-12 by the user, during F05 UAT |
| Status | Approved (raised directly by the user). In implementation together with CR-03 on branch `cr/CR-03-04-ui-refresh` |
| Affects | F04 task views and form, F05 fitment lists (web) |

## User request
> "where do the completed task live and why not use the calendar component from shadcn instead of native component which is breaking the ui as many fields dont have label but calendar picker does?"

## Finding
Completed tasks had no screen. The Open tasks view deliberately excludes `COMPLETED`. The API supports `view=all`, but the web never used it. This is a gap left by F04/F05.

## Change 1 — Completed and All tasks views (D-087)
- **API:** `GET /tasks` and `/tasks/export` accept `view=completed` (status COMPLETED, not deleted). The existing `view=all` stays.
- **Web:** two new items in the Tasks nav group, for every task viewer:
  - **Completed tasks** (`/tasks/completed`): the shared TaskTable with the same filters, search, sort, export and cards on mobile. The default sort is the latest completion first; add a `completedAt` field to Task, set by `recomputeTaskStatus` when the task becomes COMPLETED and cleared if it leaves COMPLETED. Backfill it from events in the migration.
  - **All tasks** (`/tasks/all`): every task, with the status filter including Completed.
- Dashboard links (CR-03 stat cards) can point at these.

## Change 2 — shadcn date pickers (D-088)
- Replace **every** native `type="date"`, `type="datetime-local"` and `type="time"` input in the web app with shadcn components built on `Calendar` (react-day-picker) and `Popover`:
  - `DatePicker`: a single date.
  - `DateRangePicker`: the from/to filters in task lists and fitment lists. Use one control instead of two native inputs.
  - `DateTimePicker`: a date plus a time chosen with two Selects (hour 00–23, minute in 5-minute steps). Used for requested and fitment date/time in the task form. Values are in **IST**, reusing the existing IST helpers.
- The trigger button shows the formatted value (`12 Oct 2026, 10:30`) or a placeholder ("Pick a date", "Pick date & time"). Clearable in filters. Keyboard and screen-reader accessible (the popover traps focus, Esc closes). Fits at 360 px.
- **Consistent labelling:**
  - Every field in forms has a visible `<Label>`.
  - Filter bars use one consistent pattern: either visible small labels on every control, or placeholder-only controls with an `aria-label`. Pick one and apply it to every filter control, including the date pickers.
- E2E and component tests that typed into native date inputs are updated to use the pickers. Add a helper for choosing a date and time in E2E.

## Acceptance criteria
1. Tasks → Completed tasks lists every completed task (latest first), with filters, search and CSV/Excel download. Tasks → All tasks lists everything, with a status filter that includes Completed.
2. No native date, time or date-time inputs remain in the web app.
3. Creating or editing a task uses the calendar date-time picker. The chosen IST time saves and shows correctly.
4. List date filters use a date-range calendar, and clearing it removes the filter.
5. Every form field has a visible label, and filter controls look consistent.
6. Works at 360 px. All automated tests pass.
