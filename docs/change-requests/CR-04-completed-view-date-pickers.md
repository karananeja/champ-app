# CR-04 — Completed tasks view; shadcn date pickers instead of native inputs

| | |
|---|---|
| Raised | 2026-10-12 by the user, during F05 UAT |
| Status | Implemented, awaiting user acceptance |
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

## Implementation and test results

Branch `cr/CR-03-04-ui-refresh`, commit `9d6cfef` (CR-04), plus the page polish in `6c22d1d` (CR-03). Decisions D-089, D-091, D-095 and D-097.

### Changes
- **API** (`apps/api/src/modules/tasks`): `GET /tasks` and `/tasks/export` accept `view=completed` (status COMPLETED, not deleted); `view=all` is unchanged. New `Task.completedAt` (nullable, indexed), set by `recomputeTaskStatus` when the task becomes COMPLETED and cleared when it leaves COMPLETED. The list `sort` is optional and defaults per view: `completedAt:desc` for Completed, `fitmentAt:asc` otherwise. New sorts `completedAt:desc|asc` keep tasks that aren't completed last. List and detail responses include `completedAt`; exports add a "Completed at (IST)" column.
- **Migration** `20261012200000_task_completed_at`: additive only (a nullable column, an index and a backfill). It sets `completedAt` of completed tasks to their latest final fitment event (OM approved / Closed – not done / Moved to FT), falling back to `updatedAt`. No existing value changes. It was checked against the schema (`prisma migrate diff`: empty) and on the test database. The dev database hasn't been migrated: run `pnpm db:migrate`.
- **Web**: Tasks menu → **Completed tasks** (`/tasks/completed`) and **All tasks** (`/tasks/all`) for every task viewer, using the shared TaskTable with the same filters, search, sort, CSV/Excel download and phone cards. Completed has no status filter (everything in it is Completed) and offers the completion sorts. All tasks has a status filter that includes Completed.
- **Pickers** (`components/date-picker.tsx`, `lib/dates.ts`, shadcn `ui/calendar.tsx` on react-day-picker 10 + Popover):
  - `DatePicker` (single day, clearable).
  - `DateRangePicker` (one control for from/to, with Clear and Done in the popover and an × on the trigger).
  - `DateTimePicker` (calendar plus Hour 00–23 and Minute 5-step selects, IST).
  - Triggers show `12 Oct 2026, 10:30` or a placeholder. Popovers are modal: focus stays inside, and Esc closes and returns focus.
- **No native date/time inputs remain** (`type="date"`, `datetime-local` or `time`). The task form uses DateTimePicker for requested and fitment date-time. Task lists and the three fitment lists use DateRangePicker.
- **Labels**: every form field has a visible label. Every filter control uses the placeholder + `aria-label` pattern (D-089).

### Test results (whole branch, final run)
| Suite | Before (main) | After |
|---|---|---|
| shared (Vitest) | 231 | 232 |
| API (Vitest, `champ_test`) | 262 | 270 |
| web (Vitest + jsdom) | 90 | 143 |
| E2E (Playwright, desktop + 360 px) | 37 passed, 2 skipped | 49 passed, 2 skipped |

`pnpm typecheck`, `pnpm lint` and `pnpm build` pass.

New tests for CR-04:
- API `test/tasks-completed.test.ts` (5): the completed view and default sort; all/open/status/filters; viewers and 403; a reopen clearing `completedAt`; completing again sets a new time; Closed – not done; export column; the backfill SQL run against seeded events.
- Shared: `defaultTaskSort`.
- Web `components/date-picker.test.tsx` (9): date helpers, IST today, range logic, DateTimePicker label/placeholder/IST value, 24 hours and 5-minute steps with an off-grid minute kept, Esc/focus return, range pick and clear, the popover Clear button, DatePicker.
- `task-table.test.tsx`: Completed / All / Open status filter cases.
- E2E `cr-04.spec.ts`: the RO finds the completed task under Completed tasks, searches and downloads, filters All tasks by Completed, picks 1–31 Mar 2027 in the range calendar, and clearing removes the filter. Runs on desktop and at 360 px.

Changed tests (and why):
- `task-form.test.tsx` and `task-table.test.tsx` used to type into native inputs. They now drive the pickers through `src/test/date-picker.ts`.
- `task-form.test.tsx`: the edit prefill check reads the trigger text.
- `fixtures.ts` and `task-table.test.tsx`: fixtures have `completedAt`.
- `nav.test.ts`: the two new menu items.
- Shared `tasks.test.ts`: the list query no longer fills a default sort.
- E2E `tasks.spec.ts` picks the date-times with the new `pickDateTime` helper and checks that the task shows the chosen IST time.
- `e2e/helpers.ts` adds `pickDateTime`, `pickDateRange` and `chooseCalendarDay`.
- `org.setup.ts` creates the CR accounts and tasks.

### Manual UAT checklist
1. [ ] Tasks → **Completed tasks** lists completed tasks, latest completion first. Search, customer/OE/technician/activity filters and the fitment-date range work. Download → CSV/Excel contains only completed tasks with "Completed at (IST)".
2. [ ] Tasks → **All tasks** lists every task. The status filter offers Open, Assigned, In progress and Completed.
3. [ ] Reopen a fitment that was Closed – not done on a completed task: the task leaves Completed tasks. Finish it again: it comes back at the top.
4. [ ] Create a task: both date-time fields open a calendar with Hour and Minute (5-minute steps). The trigger shows e.g. `11 Nov 2026, 10:30`. After saving, the task page shows the same IST time. Editing the task shows the saved values.
5. [ ] No browser-native date or time controls appear anywhere: task form; Open/Assigned/Completed/All tasks; Awaiting approval; Re-opened; Faulty.
6. [ ] List date filters: one range control. Pick a from and a to day, and the list filters. × (or Clear) removes the filter. Esc closes the calendar.
7. [ ] Every form field has a visible label. Filter controls look the same (placeholder text, no labels above).
8. [ ] All of the above at 360 px wide, with no horizontal scrolling.
