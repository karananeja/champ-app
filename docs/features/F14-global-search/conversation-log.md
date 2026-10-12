# F14 — Conversation Log

## 2026-10-12
- F13 accepted and merged to main.
- Claude drafted `intent.md` and sent it to the user for sign-off. Open points: adding reg no. and TT id, an SA on/off list, visibility, matching rules, web only.
- User replied "ok continue". Taken as approval with all five open points as proposed (D-242 to D-246). Created branch `feature/F14-global-search` and wrote `spec.md`. Launched two agents in parallel (Backend, Web).
- User asked "add icons to the tabs in mobile view". Logged as CR-08 on this branch: the app's bottom tabs now have SVG icons (D-247).
- Two agents (D-127): Backend ~7 min (3 commits), Web ~17 min (2 commits); only the Web agent ran the full E2E, and there was no cross-agent noise. Proposed decisions became D-248 to D-252.
- Claude's verification: reviewed the search SQL; deflaked the technician upload refusal test; full gates green (1,214 tests; E2E 73 + 4 skipped). Wrote the README, test report and decisions. Handed F14 and CR-08 to the user for UAT.
- User asked for a theme selector and reported that checked checkboxes and the bell badge were hard to see in dark mode. Logged as CR-09 on this branch (D-253 to D-255).
- User asked to drop the separate *Create task* entry from the sidebar and put all task views on one page with tabs, and asked why faulty tasks are read-only. Logged as CR-10 (an agent is implementing it); answered the faulty question (D-011/D-012: Moved to FT is final, the replacement carries the work).
- User: "both options seem to be good for FT and show the action buttons such as bulk upload and create task in open task tab only". The header buttons change went to the CR-10 agent; logged CR-11 (assign replacement, undo faulty; D-256, D-257): backend agent now, web after CR-10.
- User: "let the board tab be the first tab". Relayed to the CR-10 agent: Board first (for those who can use it), URLs unchanged.
- User: "yes, let it open board for OM and SA". Relayed to the CR-10 agent: the Tasks item opens /tasks/board for OM and SA, /tasks for others; /tasks stays the Open tab.
- CR-10 done (agent ~21 min; E2E 75/75). CR-11 done (backend ~9 min, web ~13 min). Claude fixed the live-count race in both bells (D-263) and deflaked the app notification test; full unit suite green 3× (1,248 tests).
- User asked when the analytics dashboard is planned: F15 (Reports and analytics), next after F14 is accepted.
