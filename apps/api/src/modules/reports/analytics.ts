import {
  FITMENT_STATUSES,
  addCalendarDays,
  istDayOf,
  istDayRangeInstants,
  istWeekStart,
  percentiles,
  safeRatio,
  toCsv,
  type AnalyticsQuery,
  type AnalyticsResponse,
  type FitmentStatus,
  type OeKpiRow,
  type Percentiles,
  type TechnicianKpiRow,
  type WeeklyPoint,
} from '@champ/shared';
import { Prisma } from '../../generated/prisma/client';
import { forbidden } from '../../lib/errors';
import { prisma, type User } from '../../lib/prisma';
import { cachedOrStraightDistance, type StartRow } from '../mobile/history';
import { safeText, type ExportColumn, type ExportFile } from '../tasks/export';

/** The workflow events the KPIs count (D-265). */
const COUNTED_EVENTS = ['FITMENT_STARTED', 'FITMENT_SUBMITTED', 'FITMENT_MARKED_FAULTY', 'FITMENT_VERIFIED', 'FITMENT_APPROVED', 'FITMENT_REOPENED'] as const;
type CountedEvent = (typeof COUNTED_EVENTS)[number];

interface EventRow {
  type: CountedEvent;
  at: Date;
  actorId: string;
  fitmentId: string;
  taskId: string;
  taskCreatedAt: Date;
}

interface AttributionRow {
  userId: string;
  role: 'OT' | 'OE';
  at: Date;
}

/**
 * The fitments considered (spec §2): tasks not deleted, the client / OE / region filters, and for an OE viewer
 * (D-266) their own tasks plus fitments done by their technicians (the event's actor, when there is one, or the
 * fitment's current technician). Aliases: t = Task, l = Location, ft = the fitment's technician, a = the actor.
 */
function scopeSql(actor: User, q: AnalyticsQuery, withActor: boolean): Prisma.Sql {
  const and: Prisma.Sql[] = [Prisma.sql`t."deletedAt" IS NULL`];
  if (q.clientId) and.push(Prisma.sql`t."clientId" = ${q.clientId}`);
  if (q.oeId) and.push(Prisma.sql`t."oeId" = ${q.oeId}`);
  if (q.regionId) and.push(Prisma.sql`l."regionId" = ${q.regionId}`);
  if (actor.role === 'OE') {
    and.push(
      withActor
        ? Prisma.sql`(t."oeId" = ${actor.id} OR a."managerId" = ${actor.id} OR ft."managerId" = ${actor.id})`
        : Prisma.sql`(t."oeId" = ${actor.id} OR ft."managerId" = ${actor.id})`,
    );
  }
  return Prisma.join(and, ' AND ');
}

/** Km with one decimal. */
const km = (m: number) => Math.round(m / 100) / 10;

const inc = <K>(map: Map<K, number>, key: K, by = 1) => map.set(key, (map.get(key) ?? 0) + by);

/** `GET /reports/analytics` (F15 §2): the KPIs of an IST day range. */
export async function getAnalytics(actor: User, q: AnalyticsQuery): Promise<AnalyticsResponse> {
  if (actor.role === 'OE' && q.oeId && q.oeId !== actor.id) throw forbidden('FORBIDDEN', 'You can only see your own analytics');
  const range = istDayRangeInstants(q.from, q.to);
  const joins = Prisma.sql`JOIN "Fitment" f ON f."id" = e."fitmentId"
    JOIN "Task" t ON t."id" = f."taskId"
    JOIN "Location" l ON l."id" = t."locationId"
    JOIN "User" a ON a."id" = e."actorId"
    LEFT JOIN "User" ft ON ft."id" = f."technicianId"`;
  const inRange = Prisma.sql`e."createdAt" >= ${range.gte} AND e."createdAt" < ${range.lt}`;

  const [events, attributions, statusRows] = await Promise.all([
    prisma.$queryRaw<EventRow[]>`
      SELECT e."type", e."createdAt" AS "at", e."actorId", e."fitmentId", e."taskId", t."createdAt" AS "taskCreatedAt"
      FROM "TaskEvent" e ${joins}
      WHERE e."type" IN (${Prisma.join([...COUNTED_EVENTS])}) AND ${inRange} AND ${scopeSql(actor, q, true)}`,
    prisma.$queryRaw<AttributionRow[]>`
      SELECT ra."userId", ra."role"::text AS "role", e."createdAt" AS "at"
      FROM "ReopenAttribution" ra JOIN "TaskEvent" e ON e."id" = ra."eventId" ${joins}
      WHERE ${inRange} AND ${scopeSql(actor, q, true)}`,
    prisma.$queryRaw<{ status: FitmentStatus; count: number }[]>`
      SELECT f."status"::text AS "status", COUNT(*)::int AS "count"
      FROM "Fitment" f JOIN "Task" t ON t."id" = f."taskId" JOIN "Location" l ON l."id" = t."locationId"
      LEFT JOIN "User" ft ON ft."id" = f."technicianId"
      WHERE t."fitmentAt" >= ${range.gte} AND t."fitmentAt" < ${range.lt} AND ${scopeSql(actor, q, false)}
      GROUP BY f."status"`,
  ]);

  // --- Per-user counts ---
  const of = (type: CountedEvent) => events.filter((e) => e.type === type);
  const started = of('FITMENT_STARTED');
  const submitted = of('FITMENT_SUBMITTED');
  const faulty = of('FITMENT_MARKED_FAULTY');
  const verified = of('FITMENT_VERIFIED');
  const approved = of('FITMENT_APPROVED');
  const reopened = of('FITMENT_REOPENED');

  const count = (rows: readonly { actorId: string }[]) => {
    const map = new Map<string, number>();
    for (const r of rows) inc(map, r.actorId);
    return map;
  };
  const startedBy = count(started);
  const submittedBy = count(submitted);
  const faultyBy = count(faulty);
  const verifiedBy = count(verified);
  const otReopens = new Map<string, number>();
  const oeReopens = new Map<string, number>();
  for (const r of attributions) inc(r.role === 'OE' ? oeReopens : otReopens, r.userId);

  /** Working days (D-265): IST days with at least one start, per technician. */
  const workingDays = new Map<string, Set<string>>();
  for (const e of started) {
    const days = workingDays.get(e.actorId) ?? new Set<string>();
    days.add(istDayOf(e.at));
    workingDays.set(e.actorId, days);
  }

  const technicianIds = new Set([...startedBy.keys(), ...submittedBy.keys(), ...faultyBy.keys(), ...otReopens.keys()]);
  const oeIds = actor.role === 'OE' ? new Set([actor.id]) : new Set([...verifiedBy.keys(), ...oeReopens.keys()]);

  // --- Turnaround ---
  const fieldDurations = await fieldTurnaround(submitted, range.lt);
  const endToEnd = approved.map((e) => e.at.getTime() - e.taskCreatedAt.getTime());
  // End-to-end per OE: the task's OE of each approval.
  const taskOe = new Map(
    (await prisma.task.findMany({ where: { id: { in: [...new Set(approved.map((e) => e.taskId))] } }, select: { id: true, oeId: true } })).map((t) => [
      t.id,
      t.oeId,
    ]),
  );

  // --- Km (D-216/D-223, no router calls) ---
  const kmOf = await technicianKm(workingDays, q.from, q.to);

  const users = new Map(
    (
      await prisma.user.findMany({ where: { id: { in: [...technicianIds, ...oeIds] } }, select: { id: true, name: true } })
    ).map((u) => [u.id, u]),
  );
  const byName = <R extends { user: { name: string; id: string } }>(a: R, b: R) => a.user.name.localeCompare(b.user.name) || a.user.id.localeCompare(b.user.id);

  const technicians: TechnicianKpiRow[] = [...technicianIds]
    .filter((id) => users.has(id))
    .map((id) => {
      const s = submittedBy.get(id) ?? 0;
      const st = startedBy.get(id) ?? 0;
      const days = workingDays.get(id)?.size ?? 0;
      const reopens = otReopens.get(id) ?? 0;
      const ft = faultyBy.get(id) ?? 0;
      const distance = kmOf.get(id) ?? { m: 0, approx: false };
      return {
        user: users.get(id)!,
        started: st,
        submitted: s,
        workingDays: days,
        fitmentsPerDay: safeRatio(s, days),
        reopens,
        reopenRate: safeRatio(reopens, s),
        movedToFt: ft,
        faultyRate: safeRatio(ft, st),
        km: km(distance.m),
        kmApprox: distance.approx,
        fieldTat: percentiles(fieldDurations.filter((d) => d.actorId === id).map((d) => d.ms)),
      };
    })
    .sort(byName);

  const oes: OeKpiRow[] = [...oeIds]
    .filter((id) => users.has(id))
    .map((id) => {
      const v = verifiedBy.get(id) ?? 0;
      const reopens = oeReopens.get(id) ?? 0;
      return {
        user: users.get(id)!,
        verified: v,
        reopens,
        reopenRate: safeRatio(reopens, v),
        endToEndTat: percentiles(approved.filter((e) => taskOe.get(e.taskId) === id).map((e) => e.at.getTime() - e.taskCreatedAt.getTime())),
      };
    })
    .sort(byName);

  // --- Weekly buckets (IST Mondays) ---
  const weekly: WeeklyPoint[] = [];
  const weekOf = new Map<string, WeeklyPoint>();
  for (let w = istWeekStart(q.from); w <= q.to; w = addCalendarDays(w, 7)) {
    const point = { weekStart: w, submitted: 0, approved: 0, reopens: 0, movedToFt: 0, started: 0, km: 0 };
    weekly.push(point);
    weekOf.set(w, point);
  }
  const field: Record<CountedEvent, keyof WeeklyPoint | null> = {
    FITMENT_STARTED: 'started',
    FITMENT_SUBMITTED: 'submitted',
    FITMENT_MARKED_FAULTY: 'movedToFt',
    FITMENT_APPROVED: 'approved',
    FITMENT_REOPENED: 'reopens',
    FITMENT_VERIFIED: null,
  };
  for (const e of events) {
    const key = field[e.type];
    const point = weekOf.get(istWeekStart(istDayOf(e.at)));
    if (key && point) (point[key] as number) += 1;
  }
  const weeklyM = new Map<string, number>();
  for (const dist of kmOf.values()) for (const [day, m] of dist.byDay) inc(weeklyM, istWeekStart(day), m);
  for (const point of weekly) point.km = km(weeklyM.get(point.weekStart) ?? 0);

  const counts = new Map(statusRows.map((r) => [r.status, r.count]));
  const technicianDays = [...workingDays.values()].reduce((sum, d) => sum + d.size, 0);
  const totalM = [...kmOf.values()].reduce((sum, d) => sum + d.m, 0);

  return {
    from: q.from,
    to: q.to,
    statusCounts: FITMENT_STATUSES.map((status) => ({ status, count: counts.get(status) ?? 0 })),
    turnaround: { field: percentiles(fieldDurations.map((d) => d.ms)), endToEnd: percentiles(endToEnd) },
    reopenRate: { reopens: reopened.length, submitted: submitted.length, rate: safeRatio(reopened.length, submitted.length) },
    fitmentsPerTechnicianPerDay: { submitted: submitted.length, technicianDays, average: safeRatio(submitted.length, technicianDays) },
    faultyRate: { movedToFt: faulty.length, started: started.length, rate: safeRatio(faulty.length, started.length) },
    km: { total: km(totalM), approx: [...kmOf.values()].some((d) => d.approx) },
    weekly,
    technicians,
    oes,
  };
}

/**
 * Field turnaround (D-265): each submit minus the latest assignment of that fitment to the submitting
 * technician before it (FITMENT_ASSIGNED with that technician, or TASK_CREATED with `data.technicianId`).
 * A submit without such an assignment is left out.
 */
async function fieldTurnaround(submitted: readonly EventRow[], before: Date): Promise<{ actorId: string; ms: number }[]> {
  if (!submitted.length) return [];
  const fitmentIds = [...new Set(submitted.map((e) => e.fitmentId))];
  const taskIds = [...new Set(submitted.map((e) => e.taskId))];
  const assignments = await prisma.$queryRaw<{ fitmentId: string | null; taskId: string; at: Date; technicianId: string | null }[]>`
    SELECT "fitmentId", "taskId", "createdAt" AS "at", "data"->>'technicianId' AS "technicianId"
    FROM "TaskEvent"
    WHERE "createdAt" < ${before}
      AND (("type" = 'FITMENT_ASSIGNED' AND "fitmentId" = ANY(${fitmentIds}))
        OR ("type" = 'TASK_CREATED' AND "taskId" = ANY(${taskIds})))`;
  const byFitment = new Map<string, { at: Date; technicianId: string | null }[]>();
  const byTask = new Map<string, { at: Date; technicianId: string | null }[]>();
  for (const a of assignments) {
    const map = a.fitmentId ? byFitment : byTask;
    const key = a.fitmentId ?? a.taskId;
    map.set(key, [...(map.get(key) ?? []), a]);
  }
  const out: { actorId: string; ms: number }[] = [];
  for (const s of submitted) {
    const candidates = [...(byFitment.get(s.fitmentId) ?? []), ...(byTask.get(s.taskId) ?? [])].filter(
      (a) => a.technicianId === s.actorId && a.at <= s.at,
    );
    if (!candidates.length) continue;
    const latest = Math.max(...candidates.map((a) => a.at.getTime()));
    out.push({ actorId: s.actorId, ms: s.at.getTime() - latest });
  }
  return out;
}

interface TechnicianDistance {
  m: number;
  approx: boolean;
  byDay: Map<string, number>;
}

/**
 * Km per technician (D-265): over their working days, the F12 day distance of the day (all the fitments they
 * started that day): the cached routed value when its signature matches, else straight lines (approx).
 */
async function technicianKm(workingDays: Map<string, Set<string>>, from: string, to: string): Promise<Map<string, TechnicianDistance>> {
  const out = new Map<string, TechnicianDistance>();
  const ids = [...workingDays.keys()];
  if (!ids.length) return out;
  const [fitments, cached] = await Promise.all([
    prisma.fitment.findMany({
      where: { technicianId: { in: ids }, task: { deletedAt: null }, startedAt: istDayRangeInstants(from, to) },
      select: { id: true, technicianId: true, startedAt: true, startLat: true, startLng: true, task: { select: { siteId: true } } },
    }),
    prisma.dayDistance.findMany({
      where: { userId: { in: ids }, date: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) } },
    }),
  ]);
  const startsOf = new Map<string, StartRow[]>();
  for (const f of fitments) {
    const key = `${f.technicianId}|${istDayOf(f.startedAt!)}`;
    startsOf.set(key, [...(startsOf.get(key) ?? []), f]);
  }
  const cacheOf = new Map(cached.map((c) => [`${c.userId}|${c.date.toISOString().slice(0, 10)}`, c]));
  for (const [userId, days] of workingDays) {
    const total: TechnicianDistance = { m: 0, approx: false, byDay: new Map() };
    for (const day of days) {
      const key = `${userId}|${day}`;
      const d = cachedOrStraightDistance(startsOf.get(key) ?? [], cacheOf.get(key));
      total.m += d.distanceM;
      total.approx ||= d.approx;
      total.byDay.set(day, d.distanceM);
    }
    out.set(userId, total);
  }
  return out;
}

// --- CSV tables (spec §3) ---

const pct = (rate: number | null) => (rate === null ? '' : `${Math.round(rate * 1000) / 10}%`);
const num = (value: number | null) => (value === null ? '' : value);
const tatColumns = <R>(label: string, get: (r: R) => Percentiles): ExportColumn<R>[] => [
  { header: `${label} count`, width: 10, value: (r) => get(r).count },
  { header: `${label} median (h)`, width: 12, value: (r) => num(get(r).medianHours) },
  { header: `${label} P90 (h)`, width: 12, value: (r) => num(get(r).p90Hours) },
];

export const TECHNICIAN_KPI_COLUMNS: ExportColumn<TechnicianKpiRow>[] = [
  { header: 'Technician', width: 20, value: (r) => r.user.name },
  { header: 'Started', width: 9, value: (r) => r.started },
  { header: 'Submitted', width: 9, value: (r) => r.submitted },
  { header: 'Working days', width: 9, value: (r) => r.workingDays },
  { header: 'Fitments per day', width: 9, value: (r) => num(r.fitmentsPerDay === null ? null : Math.round(r.fitmentsPerDay * 100) / 100) },
  { header: 'Reopens', width: 9, value: (r) => r.reopens },
  { header: 'Reopen rate', width: 9, value: (r) => pct(r.reopenRate) },
  { header: 'Moved to FT', width: 9, value: (r) => r.movedToFt },
  { header: 'Faulty rate', width: 9, value: (r) => pct(r.faultyRate) },
  { header: 'Km', width: 9, value: (r) => r.km },
  { header: 'Km approximate', width: 9, value: (r) => (r.kmApprox ? 'Yes' : 'No') },
  ...tatColumns<TechnicianKpiRow>('Field TAT', (r) => r.fieldTat),
];

export const OE_KPI_COLUMNS: ExportColumn<OeKpiRow>[] = [
  { header: 'Operation executive', width: 20, value: (r) => r.user.name },
  { header: 'Verified', width: 9, value: (r) => r.verified },
  { header: 'Reopens', width: 9, value: (r) => r.reopens },
  { header: 'Reopen rate', width: 9, value: (r) => pct(r.reopenRate) },
  ...tatColumns<OeKpiRow>('End-to-end TAT', (r) => r.endToEndTat),
];

/** `format=csv&table=technicians|oes` (default technicians). */
export async function analyticsFile(actor: User, q: AnalyticsQuery): Promise<ExportFile> {
  const report = await getAnalytics(actor, q);
  const table = q.table ?? 'technicians';
  const body =
    table === 'oes'
      ? toCsv(OE_KPI_COLUMNS.map((c) => c.header), report.oes.map((r) => OE_KPI_COLUMNS.map((c) => safeText(c.value(r)))))
      : toCsv(TECHNICIAN_KPI_COLUMNS.map((c) => c.header), report.technicians.map((r) => TECHNICIAN_KPI_COLUMNS.map((c) => safeText(c.value(r)))));
  return {
    filename: `analytics-${table}-${q.from}-to-${q.to}.csv`,
    contentType: 'text/csv; charset=utf-8',
    body: Buffer.from(`\uFEFF${body}`),
  };
}
