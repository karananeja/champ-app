import { createHash } from 'node:crypto';
import {
  MOBILE_ROLES,
  formatTkId,
  isMobileRole,
  istDayStart,
  type DayHistoryDto,
  type ReporteeDayDto,
  type ReporteesHistoryResponse,
  type TimelineEntryDto,
  type TimelineStep,
} from '@champ/shared';
import { Prisma } from '../../generated/prisma/client';
import { forbidden } from '../../lib/errors';
import { prisma, type User } from '../../lib/prisma';
import { haversineM, straightLineRoute, type LatLng, type RouteOptimizer } from '../../lib/router';

const DAY_MS = 24 * 3600 * 1000;
/** Consecutive start positions closer than this are one stop (D-216). */
const MERGE_RADIUS_M = 50;
/** A stored straight-line distance is retried with the router after this long. */
const APPROX_RETRY_MS = 10 * 60_000;

/** The `@db.Date` value of an IST day. */
const dbDate = (day: string) => new Date(`${day}T00:00:00.000Z`);

/** [start, end) of an IST day. */
function istDayRange(date: string): { gte: Date; lt: Date } {
  const start = istDayStart(date);
  if (!start) throw new Error(`Invalid IST day ${date}`); // the route validates the date first
  return { gte: start, lt: new Date(start.getTime() + DAY_MS) };
}

const inRange = (at: Date | null, r: { gte: Date; lt: Date }): at is Date => !!at && at >= r.gte && at < r.lt;

const historySelect = {
  id: true,
  tkNo: true,
  status: true,
  vehicleRegNo: true,
  startedAt: true,
  startLat: true,
  startLng: true,
  submittedAt: true,
  closedAt: true,
  faultyAt: true,
  closeReason: { select: { name: true } },
  task: { select: { siteId: true, client: { select: { name: true } }, site: { select: { name: true, address: true } } } },
} satisfies Prisma.FitmentSelect;
type HistoryRow = Prisma.FitmentGetPayload<{ select: typeof historySelect }>;

/** A fitment started on the day, in start order (only what the distance needs). */
export interface StartRow {
  id: string;
  startedAt: Date | null;
  startLat: number | null;
  startLng: number | null;
  task: { siteId: string };
}

/** One stored leg (DayDistance.legs): from the previous started fitment with a position. */
interface StoredLeg {
  fitmentId: string;
  distanceM: number;
}

interface DayDistance {
  distanceM: number;
  approx: boolean;
  legs: StoredLeg[];
}

/** The day's steps of a fitment (D-217), oldest first. */
function stepsOn(f: HistoryRow, range: { gte: Date; lt: Date }): TimelineStep[] {
  const steps: TimelineStep[] = [];
  if (inRange(f.startedAt, range)) steps.push({ kind: 'STARTED', at: f.startedAt.toISOString(), label: 'Started' });
  if (inRange(f.submittedAt, range)) steps.push({ kind: 'SUBMITTED', at: f.submittedAt.toISOString(), label: 'Submitted' });
  if (inRange(f.closedAt, range)) {
    const reason = f.closeReason?.name;
    steps.push({ kind: 'CLOSED_NOT_DONE', at: f.closedAt.toISOString(), label: reason ? `Closed – not done: ${reason}` : 'Closed – not done' });
  }
  if (inRange(f.faultyAt, range)) steps.push({ kind: 'MOVED_TO_FT', at: f.faultyAt.toISOString(), label: 'Moved to FT' });
  return steps.sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * The distance points of a day (D-216): start positions of the fitments started on it, in start order, without
 * those started without coordinates; consecutive positions at the same site or < 50 m apart merge into one.
 * `pointOf` maps each fitment with a position to its point index.
 */
function distancePoints(started: readonly StartRow[]): { points: LatLng[]; pointOf: Map<string, number>; signature: string } {
  const points: LatLng[] = [];
  const pointOf = new Map<string, number>();
  const raw: string[] = [];
  let prev: { siteId: string; at: LatLng } | null = null;
  for (const f of [...started].sort((a, b) => a.startedAt!.getTime() - b.startedAt!.getTime())) {
    if (f.startLat === null || f.startLng === null) continue;
    const at = { lat: f.startLat, lng: f.startLng };
    raw.push(`${f.id}:${at.lat.toFixed(6)},${at.lng.toFixed(6)}:${f.task.siteId}`);
    if (!prev || (prev.siteId !== f.task.siteId && haversineM(prev.at, at) >= MERGE_RADIUS_M)) points.push(at);
    pointOf.set(f.id, points.length - 1);
    prev = { siteId: f.task.siteId, at };
  }
  return { points, pointOf, signature: createHash('sha256').update(raw.join('|')).digest('hex') };
}

/** Per-fitment legs from the point legs: 0 inside a merged point, none for the first fitment. */
function fitmentLegs(pointOf: Map<string, number>, pointLegs: readonly { distanceM: number }[]): StoredLeg[] {
  const legs: StoredLeg[] = [];
  let prevPoint: number | null = null;
  for (const [fitmentId, point] of pointOf) {
    if (prevPoint !== null) legs.push({ fitmentId, distanceM: point === prevPoint ? 0 : (pointLegs[point - 1]?.distanceM ?? 0) });
    prevPoint = point;
  }
  return legs;
}

const sumLegs = (legs: readonly StoredLeg[]) => legs.reduce((sum, l) => sum + l.distanceM, 0);

function straightLineDistance(started: readonly StartRow[]): DayDistance {
  const { points, pointOf } = distancePoints(started);
  const legs = fitmentLegs(pointOf, straightLineRoute(points).legs);
  return { distanceM: sumLegs(legs), approx: points.length > 1, legs };
}

/**
 * A day distance without calling the router (D-223): the cached value when it is routed and its signature
 * matches the day's start points, else straight lines (approx). Used by the reportees list and the F15 KPIs.
 */
export function cachedOrStraightDistance(
  started: readonly StartRow[],
  cached: { signature: string; distanceM: number; approx: boolean } | undefined,
): { distanceM: number; approx: boolean } {
  const { points, signature } = distancePoints(started);
  if (points.length > 1 && cached && cached.signature === signature && !cached.approx) return { distanceM: cached.distanceM, approx: false };
  const { distanceM, approx } = straightLineDistance(started);
  return { distanceM, approx };
}

/**
 * The day distance of a user (D-216): the cached value when its signature matches (an approx one only for
 * 10 min), else one OSRM route request in start order (straight lines when routing is unavailable), stored.
 */
async function dayDistance(userId: string, date: string, started: readonly StartRow[], optimizer: RouteOptimizer): Promise<DayDistance> {
  const { points, pointOf, signature } = distancePoints(started);
  if (points.length < 2) return { distanceM: 0, approx: false, legs: fitmentLegs(pointOf, []) };

  const key = { userId, date: dbDate(date) };
  const cached = await prisma.dayDistance.findUnique({ where: { userId_date: key } });
  if (cached && cached.signature === signature && (!cached.approx || Date.now() - cached.computedAt.getTime() < APPROX_RETRY_MS)) {
    return { distanceM: cached.distanceM, approx: cached.approx, legs: cached.legs as unknown as StoredLeg[] };
  }

  let approx = false;
  let pointLegs: { distanceM: number }[];
  try {
    pointLegs = (await optimizer.route(points)).legs;
  } catch {
    // Routing unavailable (or too many points): straight lines.
    approx = true;
    pointLegs = straightLineRoute(points).legs;
  }
  const legs = fitmentLegs(pointOf, pointLegs);
  const data = { signature, distanceM: sumLegs(legs), approx, legs: legs as unknown as Prisma.InputJsonValue, computedAt: new Date() };
  try {
    await prisma.dayDistance.upsert({ where: { userId_date: key }, create: { ...key, ...data }, update: data });
  } catch (err) {
    // Two requests created it at once: ours is just as valid, store it.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    await prisma.dayDistance.update({ where: { userId_date: key }, data });
  }
  return { distanceM: data.distanceM, approx, legs };
}

/** Own history, or (OE only) a direct reportee's of any status (D-218); 403 otherwise. */
async function historyUser(actor: User, userId: string | undefined) {
  if (!userId || userId === actor.id) return actor;
  const target = actor.role === 'OE' ? await prisma.user.findUnique({ where: { id: userId } }) : null;
  if (!target || target.managerId !== actor.id || !isMobileRole(target.role)) {
    throw forbidden('FORBIDDEN', "You can only see your own history or your direct reportees'");
  }
  return target;
}

/** `GET /mobile/history`: a user's day timeline and distance (F12 §1). */
export async function getDayHistory(actor: User, date: string, userId: string | undefined, optimizer: RouteOptimizer): Promise<DayHistoryDto> {
  const user = await historyUser(actor, userId);
  const range = istDayRange(date);
  const rows = await prisma.fitment.findMany({
    where: {
      technicianId: user.id,
      task: { deletedAt: null },
      OR: [{ startedAt: range }, { submittedAt: range }, { closedAt: range }, { faultyAt: range }],
    },
    select: historySelect,
  });
  const started = rows.filter((f) => inRange(f.startedAt, range));
  const distance = await dayDistance(user.id, date, started, optimizer);
  const legOf = new Map(distance.legs.map((l) => [l.fitmentId, l.distanceM]));

  const entries: TimelineEntryDto[] = rows
    .map((f) => ({ f, steps: stepsOn(f, range) }))
    .sort((a, b) => a.steps[0]!.at.localeCompare(b.steps[0]!.at) || a.f.tkNo - b.f.tkNo)
    .map(({ f, steps }) => ({
      fitmentId: f.id,
      tkId: formatTkId(f.tkNo),
      status: f.status,
      customer: f.task.client.name,
      site: { name: f.task.site.name, address: f.task.site.address },
      vehicleRegNo: f.vehicleRegNo,
      steps,
      legFromPreviousM: legOf.get(f.id) ?? null,
      started: inRange(f.startedAt, range),
    }));

  return {
    date,
    user: { id: user.id, name: user.name, role: user.role },
    distanceM: distance.distanceM,
    approx: distance.approx,
    startedCount: started.length,
    entries,
  };
}

/**
 * `GET /mobile/history/reportees` (OE only): the caller's active direct reportees with their started count and
 * distance on the day, by name. Never calls the router: a matching routed cache value, else straight lines.
 */
export async function getReporteesHistory(actor: User, date: string): Promise<ReporteesHistoryResponse> {
  if (actor.role !== 'OE') throw forbidden('FORBIDDEN', 'Only an operation executive has direct reportees');
  const users = await prisma.user.findMany({
    where: { managerId: actor.id, status: 'ACTIVE', role: { in: [...MOBILE_ROLES] } },
    select: { id: true, name: true, phone: true },
    orderBy: { name: 'asc' },
  });
  const ids = users.map((u) => u.id);
  const [started, cached] = await Promise.all([
    prisma.fitment.findMany({
      where: { technicianId: { in: ids }, task: { deletedAt: null }, startedAt: istDayRange(date) },
      select: { id: true, technicianId: true, startedAt: true, startLat: true, startLng: true, task: { select: { siteId: true } } },
    }),
    prisma.dayDistance.findMany({ where: { userId: { in: ids }, date: dbDate(date) } }),
  ]);
  const cacheOf = new Map(cached.map((c) => [c.userId, c]));

  const items: ReporteeDayDto[] = users.map((user) => {
    const mine = started.filter((f) => f.technicianId === user.id);
    const distance = cachedOrStraightDistance(mine, cacheOf.get(user.id));
    return { user, startedCount: mine.length, distanceM: distance.distanceM, approx: distance.approx };
  });
  return { date, items };
}
