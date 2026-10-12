# F15 — Test Report

| | |
|---|---|
| Date | 2026-10-12 |
| Branch | `feature/F15-reports-analytics` |
| Environment | macOS, Node 24, pnpm 10, Docker (postgres:16-alpine, MinIO), Chromium (Playwright) |
| Result | **All gates pass**: typecheck, lint, build, **1,121** unit/integration tests (shared 453, api 422, web 246), **81 E2E passed / 4 skipped / 0 failed**; a 5,000-fitment load check well under target |

## 1. Agent timing (D-127)

| Agent | Wall time | Debugging | Notes |
|---|---|---|---|
| Backend (shared, API) | **~9 min** | ~1 min | No E2E (Web ran the only full run) |
| Web | **~26 min** | ~2 min | Over the 20-min box: ~6 min full E2E plus waiting for the Backend's last commit before the gates |

## 2. Definition of done

| Step | Result |
|---|---|
| Migration | None |
| New dependencies | None (charts are hand-drawn SVG, D-272) |

## 3. Quality gates (run once by the Web agent after the Backend's last commit)

| Command | Result |
|---|---|
| `pnpm typecheck` / `pnpm lint` / `pnpm build` | exit 0 |
| `pnpm test` | exit 0: shared 453, api 422, web 246 (mobile unchanged: 152) |
| `pnpm test:e2e` | exit 0: **81 passed / 4 skipped**, incl. `reports.spec.ts` on desktop and mobile-360 |

New tests: shared 4 (IST month/week helpers, ratios, percentiles), api 12 (`reports.test.ts`: billing month boundaries in IST, billable vs not, deleted and reopened out, client filter, grouping, roles, CSV and Excel sheets; analytics on hand-built data with known answers incl. a resubmit, OE vs OM reopen attribution, a faulty, two working days, weekly buckets, filters, OE scope and 403, range validation, CSV tables, cached vs straight-line km), web 9 + nav, E2E 3 × 2 projects (billing with CSV download, analytics counts, an OE sees Analytics but not Billing).

## 4. Claude's checks
**Load** (a throwaway test against the `_test` database, not committed): 5,000 OM-approved fitments spread over the current month with assign/start/submit/verify/approve events (25,000 events).

| Report | Time (2 runs) | Result |
|---|---|---|
| Billing (JSON) | 45 / 35 ms | 3,333 billable + 1,667 non-billable — exactly as created |
| Analytics | 140 / 127 ms | 5,000 submitted and started; field turnaround median = P90 = 2.0 h, exactly as built (assigned 1 h before start, submitted 1 h after) |
| Billing Excel | 128 / 121 ms | 200 |

Km was 0 there because all fitments shared one site (same-site starts add 0, D-216); km from cached and straight-line distances is covered by the API tests.

## 5. Known limitations
- No amounts, rates or invoices; no TT reimbursement (D-018).
- No scheduled or emailed reports; no analytics in the app.
- Turnaround and rates have no weekly series; their tiles show the closest weekly count.

## 6. UAT checklist (intent acceptance criteria)

**Before you start:** pull and restart `pnpm dev` (no migration). Have a few fitments final-approved this month (some with a billable final issue, some not), a reopen, and a faulty.

| # | Acceptance criterion | Manual steps | Expected |
|---|---|---|---|
| 1 | Billing month | As OM: Reports → Billing, this month; then filter one customer | Exactly the billable fitments approved this month, by client with counts; non-billable counted separately |
| 2 | Downloads | *Download CSV*, *Download Excel* | CSV with a client column; Excel with Summary + one sheet per client |
| 3 | Analytics | Reports → Analytics, this month; change filters | Six KPI tiles with weekly trends; technician and OE tables, sortable, CSV |
| 4 | Numbers match | Compare a technician's submitted count and a reopen with the task lists / History | Same numbers |
| 5 | Access | As OE: menu and Analytics; as RO: both | OE: Analytics only, scoped to own tasks/technicians; RO: both, read-only |
| 6 | Phone and tests | Open both at phone width | Usable, no sideways page scroll; §3 green |
