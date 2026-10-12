# F10 — Conversation Log

## 2026-10-12
- F09 accepted and merged to main.
- Claude drafted `intent.md` and sent it to the user for sign-off. It proposes splitting the original F10 into F10 (route, start, close, faulty) and F10B (fitment form, photos, scanning, submit, summary) to keep agent runs near 20 min (CR-06). Open points: the split, route start point and recalculation, strict order, start distance check, OEs doing fitments.
- User replied "ok continue". Taken as approval with all open points as proposed (D-154 to D-158). Created branch `feature/F10-route-and-start` and wrote `spec.md`. Launched a Backend and a Mobile agent in parallel (D-127).
- Implementation agents (D-127): Backend finished in ~18 min (6 commits: shared contracts first, DayRoute migration, OSRM client and route service, START order check, OE assignees on API and web, tests). Mobile finished in ~9 min (2 commits: Route tab, fitment screen, Start/Continue-or-Close/Close/Mark faulty, placeholder, tests). Proposed decisions became D-159 to D-176.
- Claude's verification: all gates pass (990 tests, E2E 69 + 4 skipped). Ran an Android smoke test against an isolated API on :4200 with a throwaway `_e2e` database and real OSRM routing, leaving the user's dev data untouched. Found and fixed dialog buttons hidden by the keyboard on Android (D-177). A first attempt to start the isolated API pointed at the dev database name; `prepare-db`'s `_test`/`_e2e` guard refused it and nothing was changed. Rebuilt the iOS app for the new permission text. Handed to the user for UAT.
