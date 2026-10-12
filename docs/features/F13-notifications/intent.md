# F13 — In-App Notifications (Web and Mobile): Intent

| | |
|---|---|
| Status | **Awaiting user sign-off** |
| Requirements | SRS §6.8 ("In-app notifications (web and mobile) for assignment, submission, approval, reopen and FT events"), §2 stack (Socket.IO for realtime), §4 Notification (user, type, payload, read flag) · X10, M4, M20 (push is 🔜, out of scope) · Decisions D-011 (lifecycle), D-012 (FT replacement), D-014, D-150 (the app's bell placeholder) |
| Depends on | F05 (workflow events), F12 (complete) |

## Why
Today nobody is told when something happens. A technician finds a new fitment only by opening the app, an OE only learns that work was submitted by checking the queue, and a reopened fitment can sit unnoticed. F13 adds a bell on the web and in the app that lights up the moment something needs the user's attention, and takes them straight to it.

## What will be built

**1. Which events notify whom (open point 1)**

| Event | Who is notified | Example text |
|---|---|---|
| Fitment assigned (or reassigned) to a technician | The technician (OT, or OE doing fitments, D-158) | "TK-00012 assigned to you · Zoomcar, Bengaluru depot · 14 Oct, 10:00 am" |
| Fitment unassigned / reassigned away | The previous technician | "TK-00012 was reassigned" |
| Fitment submitted | The task's OE | "TK-00012 submitted by Arjun · ready to verify" |
| OE verified | The OE's manager (OM); all active OMs if the OE has none | "TK-00012 verified by Ravi · ready for final approval" |
| OM approved (final) | The technician and the task's OE | "TK-00012 approved" |
| Reopened | The technician; and the task's OE when an OM reopens | "TK-00012 reopened by Ravi: Photos are blurred" |
| Moved to FT (faulty) | The task's OE | "TK-00012 moved to FT by Arjun · replacement TK-00031 created" |
| Travel task raised / verified (F08) | The OE who verifies it / the person who raised it | "Travel task TT-00004 raised by Arjun" |

- Nobody is notified about their own action.
- **Grouping (open point 2):** one action on many fitments of the same task (CSV bulk fill and *Submit ready*, bulk final approve, assigning several at once) sends **one** notification per person: "5 fitments of OM-00012 submitted by Arjun".

**2. The bell (web and app)**
- Web: a bell in the top bar with an unread count. App: the header bell (today a "Coming soon" placeholder, D-150) becomes live.
- Opening it lists the latest notifications, newest first, unread ones highlighted, with the time ("5 min ago", then IST date/time).
- Tapping one marks it read and opens the thing it's about:
  - **web:** the task, with the fitment's verification sheet when relevant
  - **app:** the fitment screen (technician) or the Approve-visit fitment (OE)
- *Mark all as read*.

**3. Live delivery (open point 3)**
- When the web page or the app is open, a new notification arrives within a second or two (Socket.IO) and the count updates, with a small toast.
- When it's closed, notifications wait and show on the next open. Phone push notifications (when the app is closed) come later (M20 🔜).

**4. Keeping (open point 4)**
- Notifications are kept for **30 days**, then deleted.

## Who can do what

| | SA | OM | OE | OT | RO |
|---|---|---|---|---|---|
| Receive and read own notifications (web) | ✅ | ✅ | ✅ | — (app only) | ✅ (none sent to RO yet) |
| Receive and read own notifications (app) | — | — | ✅ | ✅ | — |

## Out of scope for F13
- Push notifications to a closed app (FCM/APNs) and email.
- Notification settings (muting types).
- Notifications for masters, clients and user management.

## Acceptance criteria (UAT)
1. Assigning a fitment notifies the technician in the app within seconds; the bell shows the unread count.
2. Submitting notifies the task's OE (web and app); tapping opens the fitment to verify.
3. Verifying notifies the OE's OM; final approval notifies the technician and the OE; a reopen notifies the technician (and the OE when the OM reopens) with the reason.
4. Moving a fitment to FT notifies the task's OE with the replacement TK id.
5. A bulk action on one task sends one grouped notification.
6. *Mark all as read* clears the count; nobody is notified about their own action.
7. A user who was offline sees the notifications on the next open.
8. Works on the web, Android and iOS. Automated tests pass.

## Open points for this feature
1. **Recipients:** as in the table. In particular, OE verified → the OE's manager (all active OMs only when the OE has no manager). OK, or should every OM be notified?
2. **Grouping:** one notification per person for a bulk action on one task. OK?
3. **Live delivery:** Socket.IO while the page/app is open; no push when closed (later). OK?
4. **Keep for 30 days.** OK?
5. **Toasts:** a small toast for each live notification on the web and in the app (in addition to the bell count). OK, or bell count only?
