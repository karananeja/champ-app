# CR-06 — Faster implementation-agent runs (~20 min target)

| | |
|---|---|
| Raised | 2026-10-12 by the user |
| Status | Awaiting acceptance |
| Affects | `apps/web/playwright.config.ts`, how Claude briefs and runs implementation agents (`docs/agent-playbook.md`) |

## User request
> "check why the sub agent is taking too long to complete the task, it is taking about 45 mins for each task, try to make sure the sub agent finishes the task in about 20 mins"

## Findings (from the agent transcripts of F01–F08, CR-01, CR-03/04)
Feature agents took 35–51 min. Breakdown for F08 (51 min):

| Phase | Minutes | Notes |
|---|---|---|
| Reading spec and code | 0–4 | Reasonable |
| Shared + API code and tests | 4–13 | |
| Web UI and tests | 13–30 | |
| **E2E debugging** | **30–48** | 7 Playwright runs; 4 failed runs each waited out the **150 s test timeout** |
| Docs and commits | 48–51 | |

- About 60% of the time is the model writing code (F08 added ~5,000 lines). About 40% is tools, and Playwright dominates that.
- Infrastructure is not slow. One small spec runs in 12 s including server start, and the full suite takes 4.9 min.
- **Root cause of the E2E tail:** Playwright had no `actionTimeout`. A click on a locator that never appears (e.g. a sidebar link at 360 px, where the menu is collapsed) waited until the whole test timed out: 120–150 s for the long specs. F08 lost ~11 min to these waits alone. F05, F06 and F07 show the same 15–20 min tail.
- Every feature was built by one agent, strictly in sequence: shared, then API, then web, then E2E.

## Change
1. **Fast-fail E2E** (code): `actionTimeout: 15_000` and `navigationTimeout: 30_000` in `playwright.config.ts`. A broken step now fails in ≤ 15 s instead of ≤ 150 s. The full suite still passes (67 passed, 4 skipped; 4.9 min).
2. **Agent playbook** (process): `docs/agent-playbook.md`, followed by Claude when briefing agents (D-127):
   - Split a feature into a **backend agent** (shared + API) and a **frontend agent** (web + E2E) that run in parallel once the shared contracts are committed. Small changes stay single-agent.
   - Tight test loop: run only the touched test files and the new spec on `--project=desktop` while iterating. Read the failure's `error-context.md` before re-running. Run the full gates **once** at the end.
   - Time box: a 20 min target per agent. After 3 failed attempts at the same failure, the agent stops and reports instead of looping.
   - Briefs name the exact files to read rather than "study the existing code".

## Acceptance criteria
1. `pnpm test:e2e` passes with the new timeouts.
2. The next feature (F09) is run with the playbook, and each agent's wall time is reported in the test report. Target ≈ 20 min per agent.

## Note for the user
About 20 min per agent is a target, not a guarantee. A feature the size of F08 is mostly code-writing time, so splitting it across two parallel agents is what brings the wall time down. My own verification afterwards (full gates, ~7 min) comes on top. If a feature is still too large, I'll split it into smaller features at the intent stage.
