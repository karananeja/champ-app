import {
  OPEN_ROUTE_STATUSES,
  formatIstDateTime,
  formatTkId,
  isOpenRouteStatus,
  routeOrderMessage,
  type DayRouteDto,
  type FitmentStatus,
  type RouteEngine,
  type RouteLineString,
  type RouteOriginSource,
  type RouteStopDto,
} from '@champ/shared';
import { Prisma } from '../../generated/prisma/client';
import { conflict } from '../../lib/errors';
import { prisma, type User } from '../../lib/prisma';
import { OSRM_MAX_STOPS, straightLineTrip, type LatLng, type RouteOptimizer, type TripResult } from '../../lib/router';
import { myFitmentInclude, myFitmentsWhere, onIstDay, toMyFitmentDto, type MyFitmentRow } from './service';

type Tx = Prisma.TransactionClient;

/** One stored leg (DayRoute.legs). */
interface StoredLeg {
  fitmentId: string;
  distanceM: number;
  durationS: number | null;
}

/** The `@db.Date` value of an IST day. */
const dbDate = (day: string) => new Date(`${day}T00:00:00.000Z`);

/** The IST calendar day (YYYY-MM-DD) of an instant. */
export const istDayOf = (at: Date): string => formatIstDateTime(at).slice(0, 10);

/** When a done stop finished: submitted, closed or moved to FT, else its last change. */
const finishedAt = (f: MyFitmentRow): number => (f.submittedAt ?? f.closedAt ?? f.faultyAt ?? f.updatedAt).getTime();

const siteOf = (f: MyFitmentRow): LatLng => ({ lat: f.task.site.lat, lng: f.task.site.lng });

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && new Set([...a, ...b]).size === a.length;

interface ComputedRoute {
  origin: { lat: number; lng: number; source: RouteOriginSource } | null;
  engine: RouteEngine;
  /** Open fitment ids in visiting order. */
  fitmentIds: string[];
  legs: StoredLeg[];
  geometry: RouteLineString | null;
  computedAt: Date;
}

export interface RouteRequest {
  /** The current GPS position, if the app has one. */
  gps?: LatLng;
  /** Recompute even when the open set is unchanged (*Recalculate route*). */
  force?: boolean;
}

/**
 * The caller's day route (F10 §3): done stops first in finish order, then the open stops in the stored order
 * (D-155), recomputed when the open set changed, when there is no stored route or when forced.
 */
export async function getDayRoute(actor: User, date: string, req: RouteRequest, optimizer: RouteOptimizer): Promise<DayRouteDto> {
  const rows = await prisma.fitment.findMany({
    where: myFitmentsWhere(actor, date),
    include: myFitmentInclude(actor.id),
    orderBy: [{ task: { fitmentAt: 'asc' } }, { tkNo: 'asc' }],
  });
  const open = rows.filter((f) => isOpenRouteStatus(f.status));
  const done = rows.filter((f) => !isOpenRouteStatus(f.status)).sort((a, b) => finishedAt(a) - finishedAt(b) || a.tkNo - b.tkNo);

  let route: ComputedRoute | null = null;
  if (open.length) {
    const stored = await prisma.dayRoute.findUnique({ where: { technicianId_date: { technicianId: actor.id, date: dbDate(date) } } });
    const openIds = open.map((f) => f.id);
    if (!req.force && stored && sameSet(stored.fitmentIds, openIds)) {
      route = {
        origin:
          stored.originLat !== null && stored.originLng !== null && stored.originSource
            ? { lat: stored.originLat, lng: stored.originLng, source: stored.originSource }
            : null,
        engine: stored.engine,
        fitmentIds: stored.fitmentIds,
        legs: stored.legs as unknown as StoredLeg[],
        geometry: (stored.geometry as unknown as RouteLineString | null) ?? null,
        computedAt: stored.computedAt,
      };
    } else {
      route = await computeRoute(actor, date, open, req.gps, optimizer);
    }
  }

  const byId = new Map(rows.map((f) => [f.id, f]));
  const openOrdered = (route?.fitmentIds ?? []).map((id) => byId.get(id)!);
  const blockers = routeBlockers(openOrdered);
  const legById = new Map((route?.legs ?? []).map((l) => [l.fitmentId, l]));

  const stops: RouteStopDto[] = [
    ...done.map((f) => ({ fitment: toMyFitmentDto(f, actor), done: true, isNext: false, blockedBy: null, legFromPrevious: null })),
    ...openOrdered.map((f, i) => {
      const leg = legById.get(f.id);
      // Without an origin the first stop has no leg.
      const hasLeg = leg && !(i === 0 && !route?.origin);
      return {
        fitment: toMyFitmentDto(f, actor),
        done: false,
        isNext: blockers.get(f.id) === null,
        blockedBy: blockers.get(f.id) ?? null,
        legFromPrevious: hasLeg ? { distanceM: leg.distanceM, durationS: leg.durationS } : null,
      };
    }),
  ].map((s, i) => ({ order: i + 1, ...s }));

  return {
    date,
    origin: route?.origin ?? null,
    engine: route?.engine ?? null,
    totalDistanceM: stops.reduce((sum, s) => sum + (s.legFromPrevious?.distanceM ?? 0), 0),
    geometry: route?.geometry ?? null,
    stops,
    computedAt: route?.computedAt.toISOString() ?? null,
  };
}

/**
 * Orders the open stops from the GPS position, else the home location; with neither, nearest-neighbour from
 * the earliest stop (no origin). OSRM first, straight lines on any failure. Stores the result (upsert).
 */
async function computeRoute(
  actor: User,
  date: string,
  open: MyFitmentRow[],
  gps: LatLng | undefined,
  optimizer: RouteOptimizer,
): Promise<ComputedRoute> {
  const home = actor.homeLat !== null && actor.homeLng !== null ? { lat: actor.homeLat, lng: actor.homeLng } : null;
  const origin = gps ? { ...gps, source: 'GPS' as const } : home ? { ...home, source: 'HOME' as const } : null;

  let engine: RouteEngine = 'STRAIGHT_LINE';
  let ordered: MyFitmentRow[];
  let trip: TripResult;
  if (origin) {
    trip = straightLineTrip(origin, open.map(siteOf));
    if (open.length <= OSRM_MAX_STOPS) {
      try {
        trip = await optimizer.trip(origin, open.map(siteOf));
        engine = 'OSRM';
      } catch {
        // Fallback (routing unavailable): straight lines, already computed.
      }
    }
    ordered = trip.order.map((i) => open[i]!);
  } else {
    // `open` is sorted by fitment time: start at the earliest stop, then nearest neighbour.
    const [first, ...rest] = open as [MyFitmentRow, ...MyFitmentRow[]];
    const tail = straightLineTrip(siteOf(first), rest.map(siteOf));
    ordered = [first, ...tail.order.map((i) => rest[i]!)];
    trip = { order: [], legs: [{ distanceM: 0, durationS: null }, ...tail.legs], geometry: null };
  }

  const legs: StoredLeg[] = ordered.map((f, i) => ({ fitmentId: f.id, ...trip.legs[i]! }));
  const data = {
    originLat: origin?.lat ?? null,
    originLng: origin?.lng ?? null,
    originSource: origin?.source ?? null,
    fitmentIds: ordered.map((f) => f.id),
    legs: legs as unknown as Prisma.InputJsonValue,
    geometry: trip.geometry ? (trip.geometry as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
    engine,
    computedAt: new Date(),
  };
  const key = { technicianId: actor.id, date: dbDate(date) };
  try {
    await prisma.dayRoute.upsert({ where: { technicianId_date: key }, create: { ...key, ...data }, update: data });
  } catch (err) {
    // Two requests created it at once: the other one won; ours is just as valid, store it.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    await prisma.dayRoute.update({ where: { technicianId_date: key }, data });
  }
  return {
    origin: origin ? { lat: origin.lat, lng: origin.lng, source: origin.source } : null,
    engine,
    fitmentIds: data.fitmentIds,
    legs,
    geometry: trip.geometry,
    computedAt: data.computedAt,
  };
}

interface RouteOrderStop {
  id: string;
  tkNo: number;
  status: FitmentStatus;
  taskId: string;
}

/**
 * The stop that must go first (TK id) for each open stop in visiting order, or null when it may be started now
 * (D-156, relaxed within a task by D-202): an In-progress stop is never blocked; otherwise an In-progress stop of
 * another task blocks, then the first stop of another task before it. Mirrors `assertRouteOrder`.
 */
export function routeBlockers(openOrdered: readonly RouteOrderStop[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  openOrdered.forEach((stop, i) => {
    if (stop.status === 'IN_PROGRESS') return out.set(stop.id, null);
    const otherTask = (f: RouteOrderStop) => f.taskId !== stop.taskId;
    const blocker = openOrdered.find((f) => otherTask(f) && f.status === 'IN_PROGRESS') ?? openOrdered.slice(0, i).find(otherTask);
    out.set(stop.id, blocker ? formatTkId(blocker.tkNo) : null);
  });
  return out;
}

/**
 * Strict order on START (D-156), inside the transition's transaction: refuses with 409 ROUTE_ORDER when an
 * open fitment of another task of the technician on the same IST day is In progress, or comes before this one
 * in the stored route. Fitments of the same task never block (D-202, F11). Without a stored route any open
 * fitment may start.
 */
export async function assertRouteOrder(
  tx: Tx,
  technicianId: string,
  fitment: { id: string; taskId: string; task: { fitmentAt: Date } },
): Promise<void> {
  const date = istDayOf(fitment.task.fitmentAt);
  const stored = await tx.dayRoute.findUnique({ where: { technicianId_date: { technicianId, date: dbDate(date) } } });
  if (!stored) return;
  const others = await tx.fitment.findMany({
    where: {
      AND: [
        {
          technicianId,
          id: { not: fitment.id },
          taskId: { not: fitment.taskId },
          status: { in: [...OPEN_ROUTE_STATUSES] as FitmentStatus[] },
        },
        onIstDay(date),
      ],
    },
    select: { id: true, tkNo: true, status: true },
  });
  const inProgress = others.find((f) => f.status === 'IN_PROGRESS');
  if (inProgress) throw conflict('ROUTE_ORDER', routeOrderMessage(formatTkId(inProgress.tkNo)));
  const position = stored.fitmentIds.indexOf(fitment.id);
  if (position <= 0) return;
  const blocker = stored.fitmentIds
    .slice(0, position)
    .map((id) => others.find((f) => f.id === id))
    .find((f) => f !== undefined);
  if (blocker) throw conflict('ROUTE_ORDER', routeOrderMessage(formatTkId(blocker.tkNo)));
}
