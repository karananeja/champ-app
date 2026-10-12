# F15 — Reports (Billing) and Analytics: Intent

| | |
|---|---|
| Status | **Approved** 2026-10-12 ("ok continue"; open points as proposed, D-264 – D-268) |
| Requirements | SRS §6.9 ("Monthly billing report per client, listing billable fitments. Analytics: the KPIs in D-030.") · W17 (analytics dashboard, basic KPIs), W18 (monthly billing report per client; invoices later) · Decisions D-018 (billing = monthly per-client report of billable activities; no money, no TT reimbursement), D-030 (KPIs: tasks by status, turnaround time, reopen rate, fitments per OT per day, faulty rate, km travelled), D-074 (reopen attribution), D-101 (billable snapshot), D-216 (day distance) |
| Depends on | F06 (billable), F12 (distance), F14 (complete) |

## Why
Everything Champ records — who fitted what, when, how often work came back, how far technicians drove — is there, but nobody can see it at a glance, and month-end billing still means exporting lists and counting by hand. F15 gives the OM the monthly **billing report** per client and an **analytics** page with the agreed KPIs.

## What will be built

**1. Billing report (open point 1)**
- **Reports → Billing**: pick a **month** (IST calendar month) and optionally a **client**.
- Lists the **billable** fitments that got their **final (OM) approval in that month**, grouped by client: TK id, OM id, site, vehicle reg no. / chassis no., device id, activity, technician, final issue, OE-verified and approved dates.
- Per client and overall: count of billable fitments, plus a count of non-billable approved ones for reference. No amounts (D-018).
- **Download** as CSV or Excel (one sheet per client in Excel, plus a summary sheet).

**2. Analytics (D-030, open point 2)** — **Reports → Analytics**, with filters: date range (default this month), client, OE, region.

| KPI | Definition proposed |
|---|---|
| Tasks by status | Fitments in each status now (for fitments dated in the range), as a bar chart |
| Turnaround time | Median and 90th percentile of **assigned → submitted** (field time) and **created → final approval** (end to end), in hours/days |
| Reopen rate | Reopens ÷ submitted fitments, overall and **per technician and per OE** (who a reopen counts against, D-074) |
| Fitments per OT per day | Fitments a technician submitted per working day (days they started at least one), per technician and on average |
| Faulty rate | Fitments moved to FT ÷ fitments started |
| Km travelled | Day distance (F12) summed per technician over the range |

- Each KPI is a headline number with a trend (by week) and a per-technician / per-OE table where it applies, all downloadable as CSV.

**3. Who sees what (open point 3)**

| | SA | OM | OE | OT | RO |
|---|---|---|---|---|---|
| Billing report | ✅ | ✅ | — | — | ✅ |
| Analytics | ✅ all | ✅ all | ✅ own tasks and own technicians | — | ✅ all |

## Out of scope for F15
- Invoices, rates and amounts; TT reimbursement (D-018).
- Scheduled/emailed reports.
- Analytics in the mobile app.

## Acceptance criteria (UAT)
1. Billing for a month lists exactly the billable fitments OM-approved in that month, grouped by client with counts; filtering by client works.
2. Billing downloads as CSV and as Excel (summary + one sheet per client).
3. Analytics shows the six KPIs for the chosen range and filters, with per-technician / per-OE tables and weekly trends.
4. Numbers match the underlying lists (spot-check a technician's submitted count, a reopen count, a day's km).
5. An OE sees analytics only for their own tasks and technicians and has no Billing; an RO sees both read-only.
6. Works on desktop and phone widths. Automated tests pass.

## Open points for this feature
1. **Billing month:** fitments that got their **final OM approval** in the month (so a month's report doesn't change after it's billed, except for reopens). Or should it be by **OE-verification** date, or by **fitment date**?
2. **KPI definitions:** as in the table (in particular: turnaround = assigned → submitted and created → final approval; reopen rate per person by D-074 attribution; faulty rate = moved to FT ÷ started). OK?
3. **Access:** OE sees analytics scoped to their own tasks and technicians, no billing; RO sees everything read-only. OK?
4. **Where:** a new **Reports** menu group with *Billing* and *Analytics*; the existing Dashboard stays as is. OK?
5. **Excel layout:** a summary sheet plus one sheet per client. OK, or one flat sheet?
