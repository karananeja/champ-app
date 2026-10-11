# Champ — Project Conversation Log

Chronological log of the whole project conversation. Feature-level logs live in `docs/features/<feature>/conversation-log.md`.

---

## 2026-10-11 — Session 1: Kickoff and requirements analysis

**User:** Asked Claude to read the requirements file in the folder and begin development as the file describes.

**Claude:**
- Read `Champ App Features.docx`. The file's final instruction is: *"Do not start implementation. First analyze these requirements, identify gaps, and ask me questions required to finalize the technical architecture and tech stack."*
- Set up the SDLC documentation structure under `docs/`.
- Wrote `docs/requirements/00-requirements-analysis.md`, covering: product summary, actors, the assumed task hierarchy, MVP vs production requirements for both views, 25 gaps, 35 numbered questions (Q-A*, Q-T*, Q-B*, Q-M*, Q-I*, Q-P*), a proposed tech stack and the proposed SDLC workflow.
- Asked the user the most architecture-critical questions directly.

**User answers (round 1):**
- Offline: online-only MVP (D-008)
- Stack: frontend React + Vite + shadcn + Tailwind; backend Node.js + Express + PostgreSQL + Prisma; pnpm monorepo (D-002, D-004, D-007)
- Task split: auto-split per vehicle (D-009), which answers Q-T1
- Mobile platforms: Android + iOS (D-010), which answers Q-M2

**User answers (round 2):**
- Q-T3: confirmed the proposed status flow (D-011)

**User answers (round 3):**
- Q-T6: FT creates a replacement task, handled by the OE (D-012)
- Q-T4: task types are a name only (D-013)
- Q-M7: Approve visit = OE approves the OT's completed and submitted task (D-014)
- Q-M5: user said "it is just an option named as LAF5", which answers device type (D-022). Whether the scanned device ID label is text, a barcode or a QR code is still unclear and was asked again
- Q-M3/M4: system picks the best, most economical route; daily distance runs from task 1 to task n (D-015)
- Q-A1/A2: Google SSO limited to the domain; third-party and contractual technicians use email/password (D-016)
- Q-T7: dummy values for now (D-017)
- Q-B1/B2: simple billing report; travel reimbursement is calculated outside the system (D-018)
- Q-I1: no integrations (D-019); Q-I2: OSM is fine (D-020)
- Q-M6: OT uploads a CSV, the system fills the tasks, and the OT confirms (D-021)

**User (round 4):** "accept defaults". All remaining defaults were accepted (D-023 – D-036). M5 had no answer, so the default applies: barcode/QR plus OCR (D-023).

**Claude:**
- Wrote the baseline SRS `docs/requirements/01-requirements-spec.md`.
- Wrote the feature breakdown and build order `docs/features/README.md` (F01–F15).
- Wrote the F01 intent `docs/features/F01-foundation-auth/intent.md` and sent it to the user for sign-off.
- Initialised the git repo (D-036).

**Status:** Waiting for F01 intent sign-off. No implementation started.
