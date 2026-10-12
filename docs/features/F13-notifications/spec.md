# F13 — Technical Spec

Implements `intent.md` (approved 2026-10-12). Binding decisions: D-011, D-012, D-014, D-051 (toasts bottom-centre), D-127, D-150, D-158, D-228–D-232, plus everything from F01–F12. Reuse, don't duplicate:
- the central audit writers `writeEvent` / `writeEvents` (`apps/api/src/modules/tasks/events.ts`) — **every** fitment notification is derived from the TaskEvents they write, inside the same transaction
- the travel transitions in `apps/api/src/modules/travel/service.ts` (raise and verify) for the travel notifications
- JWT verification from `apps/api/src/lib/jwt.ts`; the web access token in `apps/web/src/lib/api.ts`, the mobile one in `apps/mobile/src/lib/api-client.ts` (`getAccessToken`, refresh)
- web: `components/layout/app-shell.tsx`, sonner toasts, React Query; mobile: `components/app-header.tsx` (the D-150 placeholder bell), `components/toast.tsx`

Three parallel agents (D-127):

| Agent | Owns |
|---|---|
| **Backend** | `packages/shared`, `apps/api`: §1–§4, §8 |
| **Web** | `apps/web` (incl. `vite.config.ts` and `e2e/`): §5 |
| **Mobile** | `apps/mobile`: §6 |

Web and Mobile code against the shared contracts in §1, which Backend commits **first**.

## 1. Shared (`packages/shared/src/notifications.ts`, exported). Backend commits it FIRST.

```ts
export const NOTIFICATION_TYPES = [
  'FITMENT_ASSIGNED', 'FITMENT_UNASSIGNED', 'FITMENT_SUBMITTED', 'FITMENT_VERIFIED', 'FITMENT_APPROVED',
  'FITMENT_REOPENED', 'FITMENT_MOVED_TO_FT', 'TRAVEL_RAISED', 'TRAVEL_VERIFIED',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotificationDto {
  id: string;
  type: NotificationType;
  /** Ready-to-show text, e.g. "TK-00012 submitted by Arjun · ready to verify", "5 fitments of OM-00012 submitted by Arjun". */
  title: string;
  /** Second line (customer · site · time, the reopen reason, the replacement TK…), or null. */
  body: string | null;
  /** Where a tap goes. */
  target: { kind: 'FITMENT'; taskId: string; fitmentId: string | null } | { kind: 'TRAVEL'; travelTaskId: string };
  /** Fitments covered (grouped notifications have several). */
  count: number;
  actor: { id: string; name: string } | null;
  read: boolean;
  createdAt: string;   // UTC ISO; updatedAt when grouped later
}
export interface NotificationListResponse { items: NotificationDto[]; unreadCount: number; nextCursor: string | null }
export const notificationListQuerySchema = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(50).default(20) });

/** Socket.IO */
export const NOTIFICATION_SOCKET_PATH = '/socket.io';
export const NOTIFICATION_EVENT = 'notification';        // payload: { notification: NotificationDto; unreadCount: number }
export const NOTIFICATION_COUNT_EVENT = 'notifications:count'; // payload: { unreadCount: number } (after read / read-all, other tabs)
export const NOTIFICATION_RETENTION_DAYS = 30;
export const NOTIFICATION_GROUP_WINDOW_MS = 2 * 60_000;
```

## 2. Data model (additive migration; keep the migration folder name sorting after `20261012800000_day_distance`, e.g. `20261012900000_notifications`)

```prisma
model Notification {
  id          String   @id @default(cuid())
  userId      String   // recipient
  type        String   // NotificationType
  taskId      String?
  fitmentIds  String[] // grouped
  travelTaskId String?
  actorId     String?
  title       String
  body        String?
  count       Int      @default(1)
  groupKey    String?  // `${type}:${taskId}:${actorId}` for groupable types
  readAt      DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@index([userId, readAt])
  @@index([userId, createdAt])
  @@index([createdAt])
}
```
(Relations to User for `userId`/`actorId` with `onDelete: Cascade` / `SetNull`.)

## 3. Rules
- **Where:** `writeEvent` / `writeEvents` call `notifyForEvents(tx, actor, events)` after inserting the TaskEvents (same transaction, so a rolled-back action notifies nobody). Travel raise/verify call the same notifier with travel inputs. Simulated events (D-073, `data.simulated`) **do** notify (that's how UAT exercises it without the app) — note it in the README.
- **Mapping (D-228):** `FITMENT_ASSIGNED` → the new technician (and `FITMENT_UNASSIGNED` "was reassigned" → `previousTechnicianId` when it differs); `FITMENT_SUBMITTED` → the task's OE; `FITMENT_VERIFIED` → the OE's manager when an active OM, else all active OMs; `FITMENT_APPROVED` → the technician and the task's OE; `FITMENT_REOPENED` → the technician, plus the task's OE when the actor is OM/SA (body: the reason); `FITMENT_MARKED_FAULTY` → the task's OE (body: "replacement TK-…", from the `FITMENT_REPLACEMENT_CREATED` written in the same call, or look it up). Travel: raised → whoever may verify it per the existing travel rules (the technician's OE; fall back to the OMs if none), verified → the raiser. **Never the actor**; deduplicate recipients; skip inactive users. Every other event type: nothing.
- **Grouping (D-229):** groupable types are all the fitment ones. Before inserting, look for an **unread** notification of the same recipient and `groupKey` updated within `NOTIFICATION_GROUP_WINDOW_MS`; if found, add the fitment id, increment `count`, rewrite `title` to the grouped form ("5 fitments of OM-00012 submitted by Arjun") and bump `updatedAt`; else insert. Lock the candidate row (`FOR UPDATE`) so parallel transactions don't lose counts.
- **Texts:** built server-side in one module with the IST helpers (examples in the intent table).
- **Delivery (D-230):** inside the transaction, `SELECT pg_notify('champ_notifications', <json {userId, notificationId}>)` for each created/updated row (Postgres delivers it only on commit). The Socket.IO server holds one dedicated `pg` client `LISTEN champ_notifications`, loads the notification and emits `NOTIFICATION_EVENT` with the unread count to the room `user:<id>`. Mark-read endpoints emit `NOTIFICATION_COUNT_EVENT` to the same room directly.
- **Socket auth:** `io(url, { path: NOTIFICATION_SOCKET_PATH, auth: { token: <access token> } })`; the server verifies the JWT (same secret/claims as `authenticate`) and that the user is active, then joins `user:<id>`; invalid → `connect_error` "UNAUTHORIZED" (the client refreshes its token and reconnects). CORS as the REST API.
- **Retention (D-231):** on startup and every 6 h (`setInterval(...).unref()`), delete notifications older than 30 days (by `updatedAt`).
- **Tests and E2E:** the socket server and the LISTEN client are created only by `server.ts` (not `createApp`), so supertest tests don't need them; expose a `startNotificationHub(httpServer)` with a `stop()` for one integration test.

## 4. API (prefix `/api`, any signed-in user)

| Method | Path | Notes |
|---|---|---|
| GET | `/notifications?cursor=&limit=` | `NotificationListResponse`, newest first by `updatedAt`, own only |
| GET | `/notifications/unread-count` | `{ unreadCount }` |
| POST | `/notifications/:id/read` | 204; 404 for someone else's |
| POST | `/notifications/read-all` | 204 |

## 5. Web agent (`apps/web`)
- **Dependency:** `socket.io-client` (exact version matching the server's major). Vite: add `'/socket.io': { target: http://localhost:${apiPort}, ws: true }` to `server.proxy` and `preview.proxy`.
- `src/features/notifications/`: `use-notifications.ts` (React Query list + unread count, socket connection while signed in using the access token from `lib/api.ts`; on `connect_error` UNAUTHORIZED refresh the session once and reconnect; on `NOTIFICATION_EVENT` prepend to the cache, set the count and show a sonner toast with the title and a *View* action; on `NOTIFICATION_COUNT_EVENT` set the count; disconnect on sign-out), `notification-bell.tsx` (bell button with a badge "9+" cap, `aria-label="Notifications, 3 unread"`, a popover list: title, body, relative time "5 min ago" then IST date/time, unread dot, *Mark all as read*, *Load more*, empty state "You're all caught up").
- Tap → mark read, then navigate: FITMENT → the task page (`/tasks/:taskId`), opening the fitment's verification sheet when `fitmentId` is set and the viewer may verify (use the existing route/query param the task page uses to open the sheet; if none exists, the task page is enough); TRAVEL → the travel task page.
- Place the bell in the top bar of `app-shell.tsx` for every role (also on phone widths, next to the menu button).
- **Tests:** unit tests for the bell (count, list, mark read, mark all, navigation, empty state) and the hook's socket handling (mock `socket.io-client`). **E2E:** one spec — OM assigns a fitment to the technician, the dev simulator submits it (D-073), the OE's bell shows the unread notification after a reload (don't rely on live sockets in E2E unless the proxy works there; if it does, assert the live toast too).

## 6. Mobile agent (`apps/mobile`)
- **Dependency:** `socket.io-client` (pure JS; same version as web; no native rebuild). Connect to the API base URL from `lib/api-base-url.ts` with `transports: ['websocket']` while signed in; reconnect with a refreshed token on UNAUTHORIZED; disconnect on sign-out; reconnect when the app returns to the foreground (`AppState`).
- The header bell (D-150 placeholder) becomes live: badge with the unread count, tap → `/notifications` screen: list (title, body, relative time, unread dot), pull to refresh, infinite scroll, *Mark all as read*, empty state.
- Live notification → toast (the existing toast, bottom-centre) and the count updates; also invalidate the home/route/approve-visit queries so screens refresh.
- Tap → mark read, then: technician notifications (assigned, approved, reopened) → `/fitment/[id]`; OE submitted → `/approve-visit/[id]`; anything else (or no fitment id) → home. Travel → home (there is no travel screen in the app).
- **Tests:** bell badge, list and mark-all, navigation per type, socket event updates the count and shows a toast (mock `socket.io-client`).

## 7. Definition of done
- **Backend:** migration applied to the dev DB (check the folder name sorts last; `prisma migrate status` clean); full gates once at the end.
- **Web:** web unit tests, typecheck, lint, the new E2E spec on desktop and mobile-360, then the full gates once.
- **Mobile:** `pnpm --filter @champ/mobile test`, typecheck, root lint, `expo-doctor`, `expo export` both platforms.
- Each agent reports its wall time, debugging minutes, proposed decisions (B-1…, W-1…, M-1…) and README notes. Claude writes the docs and checks live delivery against an isolated API.

## 8. Backend tests
- mapping truth table per event type and recipient (incl. never the actor, inactive skipped, OE without manager → all OMs, OM reopen adds the OE)
- grouping: 3 submits by the same technician on one task within the window → one notification with count 3; a different task or after the window or after it was read → a new one
- transactional: a refused transition creates no notification
- list/unread-count/read/read-all, other users' 404
- retention deletes rows older than 30 days
- socket: one integration test with `startNotificationHub` on an ephemeral port — a client with a valid token receives the event after a committed transition; a bad token gets `connect_error`
