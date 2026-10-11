# Champ — Requirements Analysis, Gap Analysis & Open Questions

| | |
|---|---|
| Source | `Champ App Features.docx` |
| Status | **DRAFT — awaiting answers from product owner** |
| Phase | SDLC Phase 1: Requirements analysis (no implementation yet) |
| Date | 2026-10-11 |

---

## 1. Product summary

Champ tracks the movement of GPS devices (device type **LAF5**) from the warehouse to customer fleets (vehicles and batteries). It covers task creation by operations managers, assignment and verification by operations executives, field execution by technicians, travel reimbursement, faulty-device handling, billing support and analytics.

Two clients:

| View | Users | Platform |
|---|---|---|
| **View One — Operations Console** | Super Admin, OM, OE, read-only (non-ops) users | React web app, mobile responsive |
| **View Two — Field App** | OT, plus OE when doing fitments themselves | React Native app |

### 1.1 Actors

| Role | Code | Key powers |
|---|---|---|
| Super Admin | SA | Manages roles and permissions, task types and master data. Can delegate task-type and user-management powers to OM |
| Operations Manager | OM | Onboards clients, creates tasks for OE, follows up, corrects tasks on request, final approval, billing and reports, deletes untouched tasks, kanban view, history and raw-data tab |
| Operations Executive | OE | Creates tasks for OT, verifies OT work, corrects images, enters verification data (issue, action, accessories, final issue, so billable or not), verifies TT, approves OT visits (mobile), can do fitments |
| Operations Technician | OT | Runs fitments one at a time on mobile, with route order, photos, checks and device scan. Can move a fitment to FT and raise TT. Three employment types: Payroll, Third party, Contractual |
| Read-only user | RO | Anyone outside the ops team. View only |

### 1.2 Task model (as I read it; confirm in Q-T1)

```
OM Task (client requirement, e.g. 5 vehicles)            ── OM task id
  └── OE Task (assigned to an OE)                         ── OE task id
        └── Technician Task × N (one per fitment/vehicle) ── Technician task id
              ├── may branch → FT (Faulty Task) for that one device only
              └── TT (Travel Task) raised by OT for travel/adhoc work
```

Task types: **OT** (operation), **TT** (travel), **FT** (faulty). SA can add more.
Approval flow, from the bottom up: **OT → OE → OM**. Each level can edit until the level above approves. Reopens are recorded with a reason and count against the OT or OE.

---

## 2. Requirements by view: MVP vs production-ready

Legend: ✅ in MVP · 🔜 production-ready (after MVP) · ❓ blocked on a question

### 2.1 Cross-cutting / platform

| # | Requirement | MVP | Prod |
|---|---|---|---|
| X1 | Email-password sign-in and sign-up (invite only) | ✅ | ✅ |
| X2 | Google SSO sign-in and sign-up | ✅ (❓ Q-A1) | ✅ |
| X3 | Invite flow: OM invites OE/OT, OE invites OT, SA invites anyone. Invite link shown once in a copyable dialog (no email) | ✅ | Email delivery, expiry, resend |
| X4 | Role-based access control: fixed roles in MVP | ✅ | SA-defined custom roles with a permission matrix 🔜 |
| X5 | SA can delegate task-type and user-management permissions to OM | ✅ | ✅ |
| X6 | Read-only access for non-ops users | ✅ | ✅ |
| X7 | Global search across configurable identifiers (device id, technician/OE/OM task id, asset no., secondary device id, chassis no., old device id) | ✅ fixed list, stored in config | Admin-managed list 🔜 |
| X8 | Master data: asset types (Battery, Vehicle), activities per asset type, device type (LAF5), vehicle make/model, installation types, locations (city/state/region), issue/action/final-issue/accessory lists, close reasons | ✅ | ✅ |
| X9 | Audit trail of every state change and edit (feeds the history tab, reopen tracking and raw data) | ✅ | ✅ |
| X10 | Notifications | In-app ✅ | Push (FCM/APNs) and email 🔜 |
| X11 | Runs locally (Docker Compose) | ✅ | Cloud deployment, CI/CD, backups, monitoring 🔜 |
| X12 | Security hardening (rate limiting, OWASP, secrets management, file scanning) | basic | 🔜 |

### 2.2 View One — web console (OM / OE / SA / RO)

| # | Requirement | MVP | Prod |
|---|---|---|---|
| W1 | Client onboarding, including picking the address on an OSM map (lat/long) | ✅ | ✅ |
| W2 | Create task (full form in §5 of the source doc). If an OE is logged in, the OE field is frozen to that user | ✅ | ✅ |
| W3 | Bulk task upload via CSV, with a downloadable sample CSV and row-level validation errors | ✅ | ✅ |
| W4 | Open-tasks dashboard (table) with filters and report download (CSV/XLSX) | ✅ | ✅ |
| W5 | Separate views: Assigned (OE only), Travel, Faulty, Re-opened | ✅ | ✅ |
| W6 | Kanban board for OM: drag to move, with automatic moves on workflow actions | ✅ (❓ Q-W3) | ✅ |
| W7 | OE verification screen: issue reported at site, action taken, accessories (checkbox), OE remarks, OT remarks (read-only), external debug image, final issue, which decides billable | ✅ | ✅ |
| W8 | OE corrects or replaces OT images | ✅ | ✅ |
| W9 | Approval chain OT → OE → OM, with edit locks after approval | ✅ | ✅ |
| W10 | Reopen with mandatory reason and a negative score against OT/OE | ✅ | ✅ |
| W11 | OM deletes a task only if no action has been taken on it | ✅ | ✅ |
| W12 | TT verification by OE, for reimbursement | ✅ | ✅ |
| W13 | History tab (OM only): stage timeline (First → Second → Final → Verification) and raw data | ✅ (❓ Q-W5) | ✅ |
| W14 | Masters admin screens: locations, technicians, activities, make/model and so on | ✅ | ✅ |
| W15 | Technician management (name, contact, email, type, home location, reporting OE) | ✅ | ✅ |
| W16 | SA: create task types | basic ✅ (❓ Q-T4) | Dynamic forms per type 🔜 |
| W17 | Analytics dashboard | basic KPIs ✅ | Full analytics 🔜 |
| W18 | Monthly billing report per client (OM) | report ✅ | Invoice generation 🔜 (❓ Q-B1) |
| W19 | Mobile responsive | ✅ | ✅ |

### 2.3 View Two — field app (OT / OE)

| # | Requirement | MVP | Prod |
|---|---|---|---|
| M1 | Login (same accounts) | ✅ | ✅ |
| M2 | Onboarding: OT sets home address/location (start point) | ✅ | ✅ |
| M3 | Home: "Show tasks" and "Approve visit" (the latter for OE only) | ✅ | ✅ |
| M4 | Header: date picker (work on past-dated tasks) and notifications icon | ✅ | ✅ |
| M5 | Route planning: order the day's fitments nearest-first from the current or home location using OSM routing, shown as a route timeline on a map | ✅ | ✅ |
| M6 | Enforced sequential execution in the order the system decides | ✅ (❓ Q-M3) | ✅ |
| M7 | Start task: current location is required (fall back to home only for display) | ✅ | ✅ |
| M8 | Pre-task choice: Continue, or Close with a reason (client unavailable / device issue) | ✅ | ✅ |
| M9 | Fitment form: photos (capture or upload), per-activity checks, reg no., chassis no., cluster reading, device replacement (device/SIM/no), device id and secondary device id with a camera scan, placement photo, comments | ✅ | ✅ |
| M10 | Device id scan via camera OCR or barcode | ✅ (❓ Q-M5) | ✅ |
| M11 | Before and after photos are required | ✅ | ✅ |
| M12 | Move a single fitment to FT (faulty) | ✅ | ✅ |
| M13 | Raise TT (travel task) | ✅ | ✅ |
| M14 | Bulk fill of many sub-tasks via CSV upload, parsed on the device, with a confirmation screen | ✅ (❓ Q-M6) | ✅ |
| M15 | History: day timeline with distance covered, sub-tabs Personal and Direct reportees | ✅ | ✅ |
| M16 | Task summary after completion | ✅ | ✅ |
| M17 | Profile (read-only): name, email, job title, phone, reporting manager name and phone | ✅ | ✅ |
| M18 | OE "Approve visit" tab | ✅ (❓ Q-M7) | ✅ |
| M19 | Offline mode (queue form and photos, sync later) | ❓ Q-M1 | 🔜 |
| M20 | Push notifications | in-app ✅ | 🔜 |
| M21 | Store distribution (Play Store / App Store) | Expo dev build / APK | 🔜 |

---

## 3. Gaps and ambiguities found

Each gap maps to a numbered question in §4.

1. **Task hierarchy is not spelled out.** Three IDs exist (OM, OE, Technician), but the doc never says how an OM task becomes OE and OT tasks. "OE can also create the OM level task for OT" is ambiguous.
2. **No status/state machine.** The kanban columns, the "First/Second/Final/Verification" stages and the approval flow aren't mapped to concrete statuses.
3. **Approval vs. closure conflict.** OE "verifies and closes the task", but the approval chain says OM approves after OE. What does OM approval do, and is it per fitment or per task?
4. **Billable logic.** The final issue "decides billable or not", but there's no mapping, rate card or billing-cycle definition.
5. **Hard-coded lists have no values.** Issue reported, issue observed, action taken, final issue, accessory list, close reasons, per-activity check options, and the employment-type implications.
6. **Per-activity checks.** Do the checks (asset condition, CAN voltage, etc.) vary by activity or asset type? Battery assets probably don't have a cluster meter or chassis number.
7. **Dynamic task types and roles (SA).** This could be a simple label or a full form builder plus permission matrix. Very different effort.
8. **Reopen "negative impact".** How is it scored, and where is it shown?
9. **Location model.** Clients have a map address, "Fitment Location" is a city/state/region master, and a GPS address is optional. Can a client have many sites? Where do the route-planner coordinates come from for each fitment?
10. **Route optimisation.** Which routing engine, whether order is strict, and what happens when a new task arrives mid-day.
11. **Distance covered.** Is it computed from the planned route, from the start/end points of each task, or from continuous background GPS tracking? Background tracking has battery and privacy implications.
12. **Offline.** Field sites often have poor connectivity. Not mentioned.
13. **OCR scanning.** Is the device id printed as text, a barcode or a QR code? This drives the library choice.
14. **Mobile CSV upload.** The sentence "this should be mobile first only than filling the sheet" is unclear.
15. **"Approve visit" (OE).** Not defined. Is it the TT, OT attendance or completed fitments?
16. **Date picker "resolve tasks from the past".** Any backdating limits?
17. **External debug image.** From which platform? Upload, or a URL?
18. **Integration with the existing Intellicar platform.** Device id validation, device inventory, health check after install (CAN voltage). None mentioned.
19. **Raw data tab.** What data is it?
20. **Org hierarchy.** "Direct reportees" and "reporting manager" imply a reporting tree. Is it OT → OE → OM?
21. **Technician vs. user.** "Add new technician" has its own form, but OTs also sign up via invite. Are these the same entity? Do third-party technicians get logins?
22. **TT reimbursement.** Per-km rate? Does it depend on technician type? Who pays out?
23. **Vehicle list.** "Upload CSV or enter number of items": are vehicle identifiers known when the task is created, or filled in by the OT?
24. **Non-functional requirements are missing.** Scale, data retention, photo size and retention, time zone, languages, Android/iOS versions, accessibility, SLAs.
25. **SDLC mechanics.** Where docs live, what sign-off looks like, and the git/repo setup.

---

## 4. Questions to finalise architecture and tech stack

### A. Auth and users
- **Q-A1.** Google SSO: should it be restricted to a company domain (e.g. `@intellicar.in`)? For a local MVP we'd need a Google OAuth client ID. Will you provide one, or should GSSO be stubbed in v1?
- **Q-A2.** Are third-party and contractual technicians given app logins with their own email addresses? Is "Add new technician" the same as inviting an OT user?
- **Q-A3.** Reporting hierarchy: does every OT report to exactly one OE, and every OE to one OM?
- **Q-A4.** How are read-only users created (invited by SA/OM)? Can they see everything, including raw data?
- **Q-A5.** Should invite links expire? (Proposed: 72 h, single use.)

### T. Tasks and workflow
- **Q-T1.** Please confirm the hierarchy in §1.2. Does creating an OE task with N vehicles **auto-generate** N technician tasks, or does the OE split them manually?
- **Q-T2.** Can different fitments of the same OE task go to different technicians?
- **Q-T3.** Please confirm or correct this status flow:
  `Open → Assigned → In progress → Submitted (OT) → OE verified → OM approved (closed)`, with branches `Closed – not done (reason)`, `Moved to FT`, `Reopened`.
- **Q-T4.** For SA-created task types, is a name plus a reuse of an existing form enough for MVP, or do you need a custom-field form builder?
- **Q-T5.** Reopen: who can reopen (OE, OM, both), up to what stage, and how is the "negative impact" measured (a count per person, shown in analytics)?
- **Q-T6.** What happens to an FT after it's created? Who handles it, and does it create a replacement fitment task?
- **Q-T7.** Please share the values for the hard-coded lists: issue reported, issue observed, action taken, final issue (and which are billable), accessories, close reasons, activities per asset type.
- **Q-T8.** Do per-activity checks differ by asset type or activity (e.g. Battery vs Vehicle)? What are the radio options for each check (e.g. OK / Not OK / NA)?

### B. Billing and reports
- **Q-B1.** "Bill incurred for the month": is a per-client report of billable activities enough, or do you need rate cards and invoice amounts?
- **Q-B2.** TT reimbursement: is it per-km based? Does it differ by technician type?
- **Q-B3.** Which KPIs are must-have for the analytics MVP? Suggestions: tasks by status, TAT, reopen rate per OT/OE, fitments per technician per day, faulty rate, km travelled.

### M. Mobile / field
- **Q-M1.** Is **offline support** required for MVP? This is the biggest architecture driver for the mobile app.
- **Q-M2.** Platforms: Android only, or Android and iOS? Is sideloading an APK acceptable for MVP?
- **Q-M3.** Is the route order strict (the OT cannot skip ahead) or a recommendation? Should the route be recomputed when tasks are added or closed mid-day?
- **Q-M4.** Distance covered: is it OK to compute it from the GPS points captured at each task start/end plus routed distance (no background tracking)?
- **Q-M5.** Are device ids printed as text, a barcode or a QR code on the LAF5 label? Can you share a sample photo?
- **Q-M6.** Mobile CSV bulk-fill: what was meant by "this should be mobile first only than filling the sheet"? Is CSV a fallback to the in-app form?
- **Q-M7.** What exactly is "Approve visit" for an OE? Approving TTs, approving completed fitments, or approving OT attendance?
- **Q-M8.** Date picker: can OTs submit work for any past date, or only within N days?

### I. Infrastructure and integration
- **Q-I1.** Should the system integrate with any existing Intellicar system (device inventory, device health/telemetry, HRMS) in MVP or later?
- **Q-I2.** OSM routing: is it OK to use the public OSRM and Nominatim demo servers for local MVP (rate-limited, not for production), then self-host OSRM with an India extract for production?
- **Q-I3.** Where should photos be stored? (Proposed: S3-compatible MinIO locally, AWS S3 in production.) Should photos be watermarked with timestamp and GPS?
- **Q-I4.** Expected scale: number of users, technicians and tasks per month?
- **Q-I5.** Production hosting target (AWS, GCP, on-prem)?
- **Q-I6.** External debug image: from which platform? Is uploading an image or pasting a URL enough?
- **Q-I7.** What does the "Raw data" tab contain? The audit log of all events, the API payloads, or the device data?

### P. Process
- **Q-P1.** Should SDLC docs live in this repo under `docs/` as Markdown? (Assumed yes.)
- **Q-P2.** Should I initialise a git repo, with a branch per feature?
- **Q-P3.** Sign-off: is an explicit "approved" reply from you in chat enough, recorded in the feature's log?

---

## 5. Architecture and tech stack

> **Round 1 decisions (2026-10-11):** pnpm monorepo, **Express** (not NestJS), PostgreSQL + Prisma, React + Vite + **shadcn/ui + Tailwind** (not MUI), React Native for Android + iOS, online-only MVP, auto-split per vehicle. The table below is the original proposal; see `docs/decision-log.md` for what is binding.

| Layer | Proposal | Why |
|---|---|---|
| Repo | pnpm workspaces + Turborepo monorepo: `apps/web`, `apps/mobile`, `apps/api`, `packages/shared` (types, zod schemas, enums) | One language and shared validation across all three apps |
| Language | TypeScript everywhere | Type safety across API and clients |
| Backend | Node.js + **NestJS** (REST + OpenAPI) | Modular structure, guards for RBAC, mature ecosystem |
| DB | **PostgreSQL + PostGIS**, Prisma ORM | Relational workflow data plus geo queries |
| Auth | JWT access/refresh tokens, bcrypt passwords, Google OAuth (passport) | Covers email-password and GSSO |
| Files | MinIO (S3-compatible) locally, S3 in prod | Same code path in both environments |
| Realtime / notifications | Socket.IO for in-app; Expo push later | |
| Background jobs | BullMQ + Redis (CSV imports, reports, route compute) | |
| Web | React + Vite, **MUI** (or shadcn/ui), TanStack Query and Table, React Hook Form + zod, dnd-kit (kanban), react-leaflet + OSM tiles, Recharts | Mature, responsive, fast to build |
| Mobile | **React Native via Expo** (dev build), expo-camera, expo-location, expo-image-picker, react-native-maps/MapLibre with OSM, ML Kit text/barcode recognition, WatermelonDB/SQLite if offline is needed | Fast iteration; native modules via dev build |
| Routing | OSRM `/trip` (TSP ordering) and Nominatim geocoding | OSM-based, as required |
| Testing | Vitest/Jest unit tests, Supertest API tests, Playwright (web E2E), Maestro (mobile E2E) | |
| Local run | Docker Compose (Postgres, Redis, MinIO, optional OSRM) | One-command setup |

---

## 6. Proposed SDLC workflow

1. **Requirements**: this document, then answers, then a signed-off requirements spec.
2. **Feature breakdown**: one folder per feature in `docs/features/<NN-feature>/`, containing:
   - `intent.md`: the feature intent, for **your sign-off before work starts**
   - `spec.md`: functional spec, acceptance criteria, API and data model
   - `conversation-log.md`: log of discussion during implementation
   - `test-report.md`: test results
   - `signoff.md`: UAT sign-off record
3. **Implementation**: a dedicated sub-agent per feature, following the approved spec.
4. **Testing**: automated tests, then a demo to you.
5. **UAT sign-off**: only then is the feature marked complete.
6. Cross-cutting records: `docs/conversation-logs/project-conversation-log.md` and `docs/decision-log.md`.
