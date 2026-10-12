# F08 — Technical Spec

Implements `intent.md` (approved 2026-10-12). Binding decisions: D-018, D-084–D-088, D-102, D-108, D-119–D-122, plus everything from F01–F07 and the CRs. Follow the existing structure and conventions. Reuse:
- the counters helper and id helpers (add TT)
- the storage lib and upload validation (F06 `verification/upload.ts`, extended to allow PDF for receipts only)
- the photo viewer
- the tasks export helpers (CSV/xlsx with formula-injection guard)
- the dashboard summary endpoint and cards
- CR-03 components, CR-04 pickers and the filter pattern

Don't duplicate them.

## 1. Data model (additive migration)

```prisma
enum TravelStatus { RAISED VERIFIED REJECTED }
enum TravelSource { WEB MOBILE }

model TravelTask {
  id               String       @id @default(cuid())
  ttNo             Int          @unique            // TT-00001 (Counter 'TT')
  technicianId     String                          // User role OT
  locationId       String                          // Location master
  clientId         String?                         // optional (D-119)
  purpose          String                          // 3..1000
  travelDate       DateTime     @db.Date           // IST calendar date, not in the future
  relatedFitmentId String?
  distanceKm       Decimal?     @db.Decimal(7, 1)  // 0 < x ≤ 5000
  status           TravelStatus @default(RAISED)
  source           TravelSource
  raisedById       String
  verifiedAt DateTime?  verifiedById String?
  rejectedAt DateTime?  rejectedById String?  rejectionReason String?
  reopenedAt DateTime?  reopenedById String?  reopenReason String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@index([technicianId, status]) @@index([travelDate]) @@index([status])
}

model TravelTaskEvent {
  id           String   @id @default(cuid())
  travelTaskId String
  actorId      String
  type         String   // TT_RAISED | TT_UPDATED | TT_VERIFIED | TT_REJECTED | TT_RESUBMITTED | TT_REOPENED | TT_ATTACHMENT_ADDED | TT_ATTACHMENT_REMOVED
  fromStatus   String?
  toStatus     String?
  data         Json?    // diffs {field:[before,after]} with readable names, reasons, attachment ids
  createdAt    DateTime @default(now())
  @@index([travelTaskId, createdAt])
}

model TravelAttachment {
  id            String   @id @default(cuid())
  travelTaskId  String
  objectKey     String   @unique   // travel/{travelTaskId}/{id}.{ext}
  contentType   String             // image/jpeg|png|webp or application/pdf
  sizeBytes     Int
  width Int?  height Int?
  originalName  String?
  uploadedById  String
  status        String   @default("ACTIVE")   // ACTIVE | REMOVED (never deleted, as D-100)
  removedById String?  removedAt DateTime?  removeReason String?
  createdAt     DateTime @default(now())
  @@index([travelTaskId, status])
}
```

Every reference is validated with the existing refs helpers:
- The technician must be an active OT.
- The location must be active (an unchanged inactive one is allowed on edit).
- The client must be active.
- The related fitment must exist and its task must not be deleted. It may belong to any technician, e.g. picking up someone else's faulty device.

## 2. Rules (shared `packages/shared/src/travel.ts`)
- `canRaiseTravel(actor, tech)`:
  - SA or OM: any technician.
  - OE: only when `tech.managerId === actor.id`.
  - OT: only when `tech.id === actor.id` (source MOBILE).
- `canVerifyTravel(actor, tt, tech)` (D-121): OM, or an OE with `tech.managerId === actor.id`. SA is view-only.
- Transition table:
  - VERIFY: RAISED → VERIFIED.
  - REJECT: RAISED → REJECTED (reason 3..500).
  - RESUBMIT: REJECTED → RAISED.
  - REOPEN: VERIFIED → RAISED (reason, OM only).
- `canEditTravel(actor, tt)`: status ∈ {RAISED, REJECTED}, and the actor is the raiser or an OM.
- RESUBMIT: the raiser or an OM. It may carry edits in the same call.
- Attachments, add and remove: whoever can edit, or the verifier while RAISED.
- `travelScope(actor)`:
  - SA, OM, RO: all.
  - OE: TTs whose technician reports to them.
  - OT: own.
- `availableTravelActions(actor, tt, tech)` for the web.
- Refusal messages follow the F05 style.

## 3. API (prefix `/api`, router: `authenticate` + roles SA, OM, OE, OT, RO; scope enforced in the service)

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/travel-tasks/options` | SA, OM, OE, OT | Technicians the caller may raise for (`{id,name,technicianType,baseLocation}`) |
| GET | `/fitments/lookup?q=` | SA, OM, OE, RO | Up to 10 fitments matching a TK id or number: `{ id, tkId, omId, client, status, technician }`, for the related-task combobox |
| GET | `/travel-tasks` | scoped | Filters: `technicianId, oeId` (technician's manager), `clientId, locationId, status, from, to` (travelDate, IST days inclusive), `q` (TT id or number), `page, pageSize, sort` (travelDate desc by default). Items carry names, the related tkId and the attachment count |
| GET | `/travel-tasks/:id` | scoped (404 when out of scope) | Full record, attachments (with presigned `url`; PDFs too), events (with actor names), flags `{ canEdit, canVerify, availableActions }` |
| POST | `/travel-tasks` | canRaiseTravel | JSON create. Source WEB for SA/OM/OE, MOBILE for OT |
| PATCH | `/travel-tasks/:id` | canEditTravel | Partial edit, with a diff event |
| POST | `/travel-tasks/:id/transitions` | per the rules | `{ action: 'VERIFY'\|'REJECT'\|'RESUBMIT'\|'REOPEN', reason?, changes? }`. RESUBMIT may include `changes` (the edit schema). Concurrency: guard the update on the current status (409 `INVALID_TRANSITION` with a message) |
| POST | `/travel-tasks/:id/attachments` | role gate SA/OM/OE/OT **before** parsing (as D-108), then the rule | multipart `file`. Up to 10 MB; JPEG/PNG/WebP/**PDF** (magic bytes); at most 10 active attachments |
| POST | `/travel-tasks/:id/attachments/:aid/remove` | as above | `{ reason? }` sets REMOVED |
| GET | `/travel-tasks/export` | scoped | Same filters, `format=csv\|xlsx`, cap 10,000. Columns: TT id, travel date, technician, technician type, OE, location, customer, purpose, related TK, distance km, status, raised by, raised at, verified/rejected by and at, rejection reason, attachment count |

Dashboard: extend the existing summary endpoint.
- OE: add `travelToVerify`, meaning RAISED TTs for their technicians.
- OM: add `travelToVerify` across all TTs.
- Web: a stat card "Travel to verify" for OE and OM, linking to `/tasks/travel?status=RAISED`.

## 4. Web
- **`/tasks/travel`** (replaces the placeholder):
  - PageHeader with a **Raise travel task** button (SA, OM, OE).
  - A filter bar (CR-04 pattern: technician, OE (hidden for an OE), customer, location, status, DateRangePicker, TT id search). Filters live in URL params.
  - Table, with cards under md: TT id, travel date, technician, location, customer, purpose (truncated), distance, status badge, attachments icon.
  - Download menu (CSV, Excel). EmptyState when nothing matches.
- **Raise / edit dialog** (full screen on mobile):
  - technician combobox (from options; preset and hidden when only one choice)
  - location combobox, customer combobox (optional)
  - purpose textarea, travel date DatePicker (future dates disabled)
  - related task combobox (searching `/fitments/lookup`), distance number input
  - receipts dropzone (images or PDF, client-side checks, progress)
  - Uploads happen after the TT is created, then the dialog closes.
- **Detail sheet:**
  - All fields, with receipts: images in the F06 viewer and PDFs as file chips that open in a new tab.
  - A history timeline (actor, action, reason, diffs) and action buttons from `availableActions`: Verify (confirm), Reject (reason), Resubmit (opens the edit form, then resubmits), Reopen (reason).
  - The status badge uses the shared tones (add travel tones).
- Server messages are shown verbatim. New files use kebab-case names.

## 5. Tests
- **Shared:** the rule matrices (raise, verify, edit, transitions, scope, available actions).
- **API:**
  - create by OE (own tech) / OM (any) / OT (self, source MOBILE) / OE for another OE's tech → 403
  - validation: future date, missing purpose, inactive references, bad related fitment, distance bounds
  - list scoping per role (OE, OT, RO) and filters; TT id search
  - verify, reject (reason required), resubmit with changes (raiser and OM; others 403), reopen (OM only); concurrent verify → one wins
  - locked edits after verify
  - attachments: image and PDF accepted, a text file refused, 10 MB limit, 10-attachment cap, role gate before parse (RO and an OT for another tech → 403), remove keeps the row
  - events with diffs
  - export CSV and xlsx columns
  - summary counts
  - `/fitments/lookup`
- **Web:** the raise dialog (validation, future dates disabled, technician preset for an OE), the detail sheet actions per flags, the reject/reopen reason dialogs, the PDF chip, filters in the URL, the dashboard card.
- **E2E** (desktop and 360 px): an OE raises a TT with a receipt; an OM sees it; the OE rejects it with a reason; the raiser resubmits with an edit; the OE verifies (locked); the OM reopens; filters and the CSV download; an RO sees it read-only.

## 6. Definition of done
- Additive migration applied to the dev DB (`pnpm db:migrate`).
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e` and `pnpm build` all pass.
- README updated.
- `test-report.md` includes a UAT checklist covering all 9 acceptance criteria.
