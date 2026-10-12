# CR-10 — Tasks in one place: a single Tasks item and tabs on the Tasks page

| | |
|---|---|
| Raised | 2026-10-12 by the user, during F14 (with three follow-ups the same day) |
| Status | Ready for UAT |
| Branch | `feature/F14-global-search` (accepted together with F14) |
| Affects | Web: sidebar, all task-list pages, E2E navigation helper |

## User requests
> "separate button for create task in the side bar is unnecessary and the tasks should be present in single place with tabs separated in the page"
>
> "show the action buttons such as bulk upload and create task in open task tab only"
>
> "let the board tab be the first tab" · "yes, let it open board for OM and SA"

## Change (D-258 – D-261)
- **Sidebar:** the eleven task entries (Create task, Bulk upload, Open tasks, Board, Assigned, Awaiting approval, Completed, All, Travel, Faulty, Re-opened) are replaced by one **Tasks** item. It opens the **Board** for SA and OM and the **Open** tab for everyone else, and stays highlighted on every task page (including task details, Create task, Bulk upload and Search).
- **Tasks page:** a "Tasks" heading and a tab bar, in this order: **Board** (SA/OM), Open, Assigned (OE), Awaiting approval (SA/OM), Re-opened, Faulty, Completed, All, Travel. Each tab keeps its existing URL (`/tasks`, `/tasks/faulty`, `/tasks/travel?tt=…`, …), so bookmarks, dashboard cards, notification and search links keep working. On phones the tab bar scrolls sideways inside itself; the page doesn't.
- **Create task** and **Bulk upload** are buttons at the top right of the **Open** tab only, for task creators.
- Each view keeps its own title and description as a second-level heading. Task details, Create task, Bulk upload and Search have no tab bar.

## Acceptance criteria
1. The sidebar has one *Tasks* item; as OM/SA it opens the Board, as OE/RO the Open tab.
2. The tabs appear in the order above (per role) and switch views; the active tab is highlighted.
3. *Create task* and *Bulk upload* appear only on the Open tab, only for creators.
4. Old links (dashboard cards, notifications, search results) still open the right view; no sideways page scroll on a phone.
5. Automated tests pass.

## Verification
Agent (~21 min): web unit 229 (nav per role, tab order per role, active tab, creator buttons on Open only); new `e2e/cr-10.spec.ts`; full E2E 75 passed / 4 skipped on desktop and mobile-360. The E2E `navigate()` helper now reaches task views through the Tasks tabs; the no-sideways-scroll check ignores the tab bar's own scroll strip.
