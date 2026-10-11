# Champ — Software Requirements Specification (MVP v1)

| | |
|---|---|
| Version | 1.0 (baseline) |
| Date | 2026-10-11 |
| Status | **Baseline — derived from user answers. See `docs/decision-log.md` (D-001 … D-036)** |
| Inputs | `Champ App Features.docx`, `00-requirements-analysis.md` |

---

## 1. Scope

Champ tracks device fitment operations, from the warehouse to customer fleets. It is made up of:

- **Operations Console** (web): used by SA, OM, OE and RO users. Mobile responsive.
- **Field App** (Android and iOS): used by OT, and by OE when an OE does fitments.
- **API**: a single backend serving both clients.

MVP v1 runs locally, is online-only and has no third-party integrations except OpenStreetMap services.

## 2. Tech stack (binding)

| Layer | Choice |
|---|---|
| Monorepo | pnpm workspaces: `apps/api`, `apps/web`, `apps/mobile`, `packages/shared` |
| Language | TypeScript |
| API | Node.js + Express, zod validation, JWT (access + refresh), bcrypt |
| DB | PostgreSQL + Prisma |
| Files | MinIO (S3 API) |
| Web | React + Vite + shadcn/ui + Tailwind, TanStack Query/Table, React Hook Form, dnd-kit, react-leaflet (OSM tiles), Recharts |
| Mobile | React Native (Expo dev build): expo-camera, expo-location, expo-image-picker, ML Kit text recognition, barcode scanning, OSM map |
| Geo | OSM tiles, public OSRM (`/trip`, `/route`), public Nominatim |
| Realtime | Socket.IO (in-app notifications) |
| Local infra | Docker Compose (Postgres, MinIO) |
| Tests | Vitest + Supertest (API), Vitest + Testing Library (web), Playwright (web E2E), Jest (mobile) |

## 3. Roles and permissions

| Capability | SA | OM | OE | OT | RO |
|---|---|---|---|---|---|
| Invite users | any role | OE, OT, RO | OT | — | — |
| Manage roles / task types / masters | ✅ | if delegated (task types, user mgmt); masters ✅ | — | — | — |
| Onboard clients | ✅ | ✅ | — | — | view |
| Create task (OM task) | ✅ | ✅ | ✅ (OE field frozen to self) | — | — |
| Bulk CSV task upload | ✅ | ✅ | ✅ | — | — |
| Assign fitments to OT | ✅ | ✅ | ✅ | — | — |
| Execute fitment (mobile) | — | — | ✅ | ✅ | — |
| Verify / approve submitted fitment | — | — | ✅ | — | — |
| Final approve | ✅ | ✅ | — | — | — |
| Edit task | before OM approval, or on request | ✅ | before OM approval | before OE approval | — |
| Reopen | ✅ | ✅ | ✅ | — | — |
| Delete task (no actions taken) | ✅ | ✅ | — | — | — |
| Kanban, history, raw data | ✅ | ✅ | — | — | — |
| Raise TT | — | — | ✅ | ✅ | — |
| Verify TT | — | ✅ | ✅ | — | — |
| Reports, analytics, global search | ✅ | ✅ | ✅ | own | ✅ (read only) |

Reporting hierarchy: OT → OE → OM (each person has one manager; D-024).

## 4. Domain model (summary)

- **User**: name, email, phone, job title, role, status, manager, auth provider. Technician users also have: technician type (Payroll / Third party / Contractual), home location (lat/lng, address) and base location.
- **Invite**: email, role, inviter, token hash, expiry (72 h), used flag.
- **Client**: name, address, map lat/lng, POCs.
- **Masters**: AssetType (Battery, Vehicle), Activity (per asset type), DeviceType (LAF5), VehicleMakeModel, InstallationType (GPS, GPS+CAN), Location (city, state, region), State, Region, IssueReported, IssueObserved, ActionTaken, FinalIssue (with `billable` flag), Accessory, CloseReason, ShiftType, TaskType (OT, TT, FT plus custom names), SearchIdentifier.
- **OmTask** (`OM-xxxxx`): the client requirement and every field of the create-task form.
- **OeTask** (`OE-xxxxx`): the OmTask as assigned to an OE. In MVP it is 1:1 with OmTask.
- **FitmentTask** (`TK-xxxxx`, the technician task id): one per vehicle, auto-generated (D-009). Holds the assigned technician, status, route order, execution data, photos, verification data and billable flag. Replacement tasks link to their source FT (D-012).
- **TravelTask**: location, customer, technician, purpose, OE verification.
- **TaskEvent**: an append-only audit log (actor, action, from/to status, diff, timestamp). Feeds history, raw data (D-033) and reopen metrics.
- **Photo**: object key, kind (asset, cluster, placement, before, after, debug), GPS, timestamp.
- **DayRoute**: technician, date, ordered fitments, routed distance.
- **Notification**: user, type, payload, read flag.

## 5. Task lifecycle (D-011)

```
Open ──assign OT──▶ Assigned ──OT starts (GPS required)──▶ In progress ──OT submits──▶ Submitted
  ▲                                     │                       │                          │
  │                                     │                  OT: No, close          OE approves (web or mobile "Approve visit")
  │                                     │                       ▼                          ▼
  │                                     │              Closed – not done (reason)    OE verified ──OM approves──▶ OM approved (final)
  │                                     │
  │                                     └──OT marks device faulty──▶ Moved to FT ──auto-creates──▶ replacement fitment (Open, OE handles)
  │
  └── Reopened (OE/OM, reason required, allowed until OM approval; counted against OT/OE)
```

Edit locks: OT can edit until OE verifies. OE can edit until OM approves. OM can edit at any time when requested.
OM kanban columns are these statuses. Moving a card runs the same transition, with the same rules, as the matching action button. History stages map as: First = Open/Assigned, Second = In progress/Submitted, Verification = OE verified, Final = OM approved.

## 6. Functional requirements

### 6.1 Auth and users (FR-AUTH)
1. Sign in with email/password. Sign in with Google, restricted to the company domain and only shown when the env var is configured (D-016, D-034).
2. Sign-up is by invite only. The invite link is shown once in a copy dialog (D-006). Links are single use and expire after 72 h.
3. Invite permissions follow §3. The inviter also sets the manager for OE/OT users.
4. SA manages users (activate/deactivate, change role or manager) and delegates task-type and user-management powers to OM.
5. Profile is read-only: name, email, job title, phone, manager name and phone.
6. On first mobile login, an OT must set their home location.

### 6.2 Masters (FR-MST)
CRUD for every master in §4. Dummy seed values are used for the lists (D-017). The location form has city (input), state (select) and region (select). The technician form has name, contact, email and type; creating a technician also creates the invite.

### 6.3 Clients (FR-CLI)
Create and edit clients, with the address picked on an OSM map (pin + Nominatim search) to capture lat/lng.

### 6.4 Tasks — web (FR-TSK)
1. The create-task form contains every field in source doc §Create task. The OE field is frozen when an OE is logged in. Vehicle list entry is either a CSV upload or a count, and one FitmentTask is generated per vehicle.
2. Bulk CSV upload uses the same fields, offers a sample CSV download and reports row-level errors without importing invalid rows.
3. Table views: Open tasks, Assigned (OE only), Travel, Faulty, Re-opened. Each has filters and CSV/XLSX export.
4. OE verification screen: issue reported at site, action taken, accessories (checkboxes), OE remarks, OT remarks (read-only), debug image upload, final issue (which sets billable). The OE can replace OT photos.
5. Task actions: assign, approve, final-approve, reopen (with reason), delete (OM only, and only with no events after creation).
6. OM kanban board.
7. History tab (OM): stage timeline plus raw event log.

### 6.5 Travel tasks (FR-TT)
OT or OE raises a TT with location, customer, technician and purpose. The OE (or OM) verifies it. No money is calculated (D-018).

### 6.6 Field app (FR-MOB)
1. Home: Show tasks, and Approve visit (OE only). Header: date picker (up to 7 days back, D-029) and notifications.
2. The task list for the selected date is ordered by the OSRM trip from the current location (falling back to home). It's shown on a map and as an ordered timeline. The OT follows the system order (D-015).
3. Start task: current location is required.
4. Continue = Yes shows the fitment form (source doc §OT task fields). Continue = No shows close reason and comments.
5. Before and after photos are required. Each photo can be captured or uploaded, and is compressed and stamped with time and GPS.
6. Device ID and secondary device ID can be typed, or scanned as barcode/QR or OCR text (D-023).
7. A single fitment can be marked faulty, which moves it to FT and creates a replacement.
8. CSV bulk fill: the OT uploads a CSV, the system pre-fills the fitments and the OT confirms (D-021).
9. Task summary after completion.
10. History: the day's timeline and distance (routed distance from task 1 to task n), with tabs Personal and Direct reportees.
11. Approve visit: the OE approves submitted fitments (D-014).

### 6.7 Search (FR-SRCH)
Global search over the configured identifiers: device id, technician/OE/OM task id, asset number, secondary device id, chassis no., old device id. The identifier list is maintained by SA.

### 6.8 Notifications (FR-NTF)
In-app notifications (web and mobile) for assignment, submission, approval, reopen and FT events.

### 6.9 Reports and analytics (FR-RPT)
1. Monthly billing report per client, listing billable fitments.
2. Analytics: the KPIs in D-030.

## 7. Non-functional requirements (MVP)
- Responsive web down to 360 px width.
- API p95 under 500 ms for list endpoints with 10k tasks.
- Passwords stored with bcrypt. JWT access token lasts 15 min, refresh token 7 days. RBAC is enforced on the server.
- Every state change is audited.
- Time zone IST; English only.
- One-command local start: `docker compose up` plus `pnpm dev`.

## 8. Out of scope for MVP (production backlog)
Offline sync, push notifications (FCM/APNs), email delivery of invites, custom role permission matrix UI, dynamic forms per task type, invoices and rate cards, self-hosted OSRM/Nominatim, cloud deployment and CI/CD, store publishing, background GPS tracking.
