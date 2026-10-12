# F07 — Test Report

| | |
|---|---|
| Date | 2026-10-12 |
| Branch | `feature/F07-om-kanban` |
| Environment | macOS, Node 24, pnpm 10.33, Docker (postgres:16-alpine, pgsty/minio), Chromium (Playwright 1.64) |
| Result | **All gates pass**: typecheck, lint, 800 unit/integration tests, 65 E2E tests (4 skipped by design), build with bundle check |

## 1. Definition of done

| Step | Command | Result |
|---|---|---|
| Migration | — | **None.** The board reads existing columns; the indexes on `Fitment.status` and `Task.fitmentAt` cover the queries, so no index was added |
| New dependency | `pnpm --filter @champ/web add @dnd-kit/core@^6.3.1` | Pure JavaScript, no native build |
| No dev-DB user data used | — | No tokens were minted for real users; the board was checked by the automated suites only (E2E uses its own `champ_e2e` database and throwaway accounts) |

## 2. Quality gates

| Command | Result |
|---|---|
| `pnpm typecheck` | exit 0 (shared, api, web) |
| `pnpm lint` | exit 0: 0 errors, 0 warnings |
| `pnpm test` | exit 0: **800 passed / 0 failed** (shared 333, api 296, web 171) |
| `pnpm test:e2e` | exit 0: **65 passed / 0 failed / 4 skipped** (the CR-02 sidebar and read-only specs, and F07's keyboard-drag and 403 tests, run on desktop only) |
| `pnpm build` | exit 0; *"Bundle check: no dev simulator in dist"*. Vite's existing "chunk larger than 500 kB" warning for the main chunk remains |

| Suite | Before (F06) | After |
|---|---|---|
| `packages/shared` | 247 | **333** (+86, `test/board.test.ts`) |
| `apps/api` | 289 (main after F06's last fix) | **296** (+7, `board.test.ts`) |
| `apps/web` | 161 | **171** (+10 `board/board-page.test.tsx`; `nav.test.ts` updated) |
| E2E | 51 + 2 skipped | **65 + 4 skipped** (+14: `board.spec.ts`, 8 tests on desktop and 6 at 360 px) |

### 2.1 Shared (`test/board.test.ts`)
Column, lane and finished-status lists; the **full 9×9 `boardMove` matrix** (6 allowed moves, 75 refused, each refused
pair has a message); `boardTargets` for the "Move to…" menu; the refusal messages (technician steps, OE verification,
approved and moved-to-FT fitments, `transitionRefusal` reuse for approve and reopen, assign/unassign, same column);
`canUseBoard` (SA and OM only); the board query schemas (default 50, max 100, IST days, `page`).

### 2.2 API (`champ_test`)
`board.test.ts`: **grouping and counts** for all 9 statuses with the card shape (task ids, customer, city, activity,
technician, billable, reopen count); **order** by fitment date then TK number and the replacement link; **filters**:
customer, OE, technician, activity, date range (`from`, `to`, both), `q` by TK, OM and OE id and a bare number, and a
non-id search matching nothing; the **7-day finished window** (an approval and a closure 10 days old hidden, recent
ones shown, both shown when a fitment-date range covers them; the column endpoint follows the same rule);
**pagination** through `/board/:status` (pages 1–3, `hasMore`), unknown status 400, `pageSize` > 100 400; **deleted
tasks excluded**; **403 for OE, RO and OT** on both routes, 401 without a token; **query count constant** (a client
with Prisma query logging counts the same number of SQL queries for 2 cards and for 32 cards with replacements).

### 2.3 Web (`board/board-page.test.tsx`, jsdom)
Columns with counts and the collapsed side lanes ("Other" opens them), "Load more" only when the server has more,
"Nothing here", badges, the 7-day note; **real keyboard drags through dnd-kit**: while a card is held the other
columns are greyed out with `aria-disabled` (checked against `boardMove`), the drag overlay shows the card;
**Open → Assigned opens the assign dialog** and sends `POST /tasks/:id/assign`; **a refused drop (Assigned →
Submitted) shows the reason**, opens nothing, calls nothing and the card stays; **Assigned → Open confirms the
unassign**; **OE verified → Reopened asks for the reason** and sends it; **multi-select approve** calls
`POST /fitments/approve` with both ids, the overlay reads "2 fitments" and the cards move **before** the server
answers (optimistic, counts adjusted); a failed bulk approve **rolls back** and lists the failed TK id with the
server's message; Shift-click range selection, and a card from another column starting a new selection; at phone
width the **"Move to…" menu lists only the allowed targets** (none for In progress) and opens the reopen dialog;
**filters are written to the URL** (technician combobox, id search after the debounce) and sent to the API, Clear
filters empties the URL and the search box; the **quick view** links to the task and offers the server's actions.

### 2.4 E2E (`e2e/board.spec.ts`)
The setup project creates a board OM per viewport, an OE, and per viewport one task per scenario; each test filters
the board to its own task by OM id.

| Test | Desktop | 360 px |
|---|---|---|
| Open → Assigned with a technician; the task page agrees (desktop also uses the Tasks → Board menu entry) | pointer drag (mouse down, move in steps, up) | "Move to…" menu |
| Keyboard drag (Space, ArrowRight, Space) Open → Assigned | ✅ | skipped (phones use the menu) |
| Two selected OE-verified cards final-approved in one move | pointer drag of one selected card | "Move to…" on a selected card |
| Reopened with a reason; reopen badge ×1 | pointer drag onto the collapsed Reopened lane | "Move to…" menu |
| Forbidden move | drag Assigned → Submitted: "Only the technician can start or submit work", card back in Assigned | the menu offers only "Open"; no horizontal page scroll |
| Simulator START through the API while the board is open → card moves to In progress after a tab focus event | ✅ | ✅ |
| Quick view opens from a card, shows *Change technician*, and links to the task | ✅ | ✅ |
| OE gets the 403 page at `/tasks/board` and has no Board menu entry | ✅ | skipped (role check once) |

## 3. Known limitations
- **No "simulated" badge** on cards: the intent listed one, but the spec's `BoardCard` has no such field (the
  simulated flag lives on events). See D-117.
- Refresh is polling (30 s) and focus-based; instant updates come with notifications in F13.
- On phones cards are not draggable; the "Move to…" menu replaces dragging (by design). Swiping between columns uses
  CSS scroll-snap; the picker follows the swipe.
- Keyboard dragging steps through the columns in a fixed order (6 main columns, then the 3 lanes) rather than by
  screen geometry.
- A selection holds cards of one column; picking a card in another column starts a new selection.
- After a partial failure (e.g. some cards of a bulk approve refused) the board rolls back and then refetches, so the
  cards that did move appear a moment later.
- Vite's existing "chunk larger than 500 kB" warning remains (dnd-kit adds ~45 kB minified to the main chunk).

## 4. UAT checklist

Sign in as an OM (or the seeded SA `admin@intellicar.in`). `pnpm db:seed:demo` gives demo tasks; the task page's
*Simulate technician (dev only)* panel moves fitments through the technician steps.

| # | Acceptance criterion | Steps | Expected |
|---|---|---|---|
| 1 | Board with 6 columns + 3 side lanes and counts; OE, RO, OT don't see it | Sidebar → Tasks → **Board**. Compare a column count with the matching list (e.g. Awaiting approval = OE verified). Open **Other**. Then sign in as an OE and as an RO: no Board entry; open `/tasks/board` directly | Open, Assigned, In progress, Submitted, OE verified, OM approved columns with counts; Other shows Reopened, Closed – not done, Moved to FT with counts. OE/RO: no menu entry and the "You don't have access" page |
| 2 | Open → Assigned asks for a technician; the task page agrees | Drag an Open card onto Assigned, choose a technician, Assign. Click the card → *Open task* | The card lands in Assigned with the technician's name; the task page shows the fitment Assigned to that technician |
| 3 | OE verified → OM approved; several at once | Tick two OE-verified cards (Shift-click for a range), drag one onto OM approved, confirm | Both cards move to OM approved; toast "Final-approved 2 fitments" |
| 4 | Reopen asks for a reason; badge goes up | Drag a Submitted (or OE-verified / Closed – not done) card onto the Reopened lane, give a reason | The card moves to Reopened with "Reopened ×N" increased by one |
| 5 | Greyed-out columns; forbidden drop refused with the reason | Pick up an Assigned card and hover over the columns; drop it on Submitted | All columns except Open are greyed while dragging; the drop shows "Only the technician can start or submit work" and the card returns to Assigned |
| 6 | Others' changes appear within 30 s or on returning to the tab | Keep the board open in one tab; in another tab use *Simulate technician → Start work* on an Assigned fitment (or verify as the OE). Wait ≤ 30 s, or switch back to the board tab | The card moves to In progress (or OE verified) without reloading |
| 7 | Filters, id search, finished 7 days, Load more | Filter by customer, OE, technician, activity, a fitment date range, and search `TK-…`, `OM-…`, `OE-…`; reload the page; clear filters. Approve something older than 7 days (or check an old approval) | Each filter narrows the board and survives a reload (it's in the URL); without a date range the note "Finished columns show the last 7 days" shows and older finished fitments are hidden; a range covering them shows them; a column with more than 50 cards has **Load more** |
| 8 | Quick view links to the task | Click a card | A side panel with the summary, verification and photos (when present), the allowed actions, and *Open task OM-…* which opens the task page |
| 9 | 360 px: one column, swipe, "Move to…"; keyboard dragging on desktop | Phone width: pick a column in the picker, swipe left/right, use a card's ⇄ **Move to…** menu. Desktop: Tab to a card, Space, arrows, Space | One column at a time, the picker follows the swipe, the menu lists only allowed targets and opens the same dialogs. Keyboard: the card picks up, columns highlight as you arrow, Space drops (Escape cancels, Enter opens the quick view) |
| 10 | Automated tests pass | `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e && pnpm build` | All exit 0 (see §2) |
