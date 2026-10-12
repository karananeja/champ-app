import { z } from 'zod';
import { isoDay, mobileDateOptions, mobileDateQuerySchema, MOBILE_PAST_DAYS, type MyFitmentDto } from './mobile';
import type { FitmentStatus } from './tasks';

// --- Day route (F10, D-015, D-155, D-156) ---

/** Fitment statuses that are still to do on a route (open stops); everything else is done. */
export const OPEN_ROUTE_STATUSES = ['ASSIGNED', 'REOPENED', 'IN_PROGRESS'] as const satisfies readonly FitmentStatus[];
export const isOpenRouteStatus = (status: FitmentStatus): boolean =>
  (OPEN_ROUTE_STATUSES as readonly FitmentStatus[]).includes(status);

export const ROUTE_ORIGIN_SOURCES = ['GPS', 'HOME'] as const;
export type RouteOriginSource = (typeof ROUTE_ORIGIN_SOURCES)[number];
export const ROUTE_ENGINES = ['OSRM', 'STRAIGHT_LINE'] as const;
export type RouteEngine = (typeof ROUTE_ENGINES)[number];

const latitude = z.number().min(-90, 'Invalid GPS location').max(90, 'Invalid GPS location');
const longitude = z.number().min(-180, 'Invalid GPS location').max(180, 'Invalid GPS location');

/** `GET /mobile/route?date=&lat=&lng=`: lat and lng both or neither. */
export const routeQuerySchema = mobileDateQuerySchema
  .extend({
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
  })
  .refine((q) => (q.lat === undefined) === (q.lng === undefined), {
    message: 'Send both lat and lng, or neither',
    path: ['lat'],
  });
export type RouteQuery = z.infer<typeof routeQuerySchema>;

/** `POST /mobile/route/recalculate`: the current GPS position is required. */
export const recalculateRouteSchema = z.object({
  date: isoDay.refine((d) => mobileDateOptions(new Date()).includes(d), {
    message: `Choose today or one of the last ${MOBILE_PAST_DAYS} days`,
  }),
  lat: z.number({ error: 'The current GPS location is required' }).pipe(latitude),
  lng: z.number({ error: 'The current GPS location is required' }).pipe(longitude),
});
export type RecalculateRouteInput = z.infer<typeof recalculateRouteSchema>;

/** A GeoJSON LineString ([lng, lat] pairs). */
export interface RouteLineString {
  type: 'LineString';
  coordinates: [number, number][];
}

export interface RouteLegDto {
  distanceM: number;
  /** null for straight-line legs. */
  durationS: number | null;
}

export interface RouteStopDto {
  /** 1..n across the whole day (done stops first, then open in route order). */
  order: number;
  fitment: MyFitmentDto;
  /** Status not in OPEN_ROUTE_STATUSES. */
  done: boolean;
  /** The one stop that may be started (D-156). */
  isNext: boolean;
  /** TK id of the stop that must go first, for open non-next stops. */
  blockedBy: string | null;
  /** Open stops only. */
  legFromPrevious: RouteLegDto | null;
}

export interface DayRouteDto {
  /** YYYY-MM-DD (IST). */
  date: string;
  /** null when there are no open stops, or no GPS and no home location. */
  origin: { lat: number; lng: number; source: RouteOriginSource } | null;
  /** null when there are no open stops. */
  engine: RouteEngine | null;
  /** Sum of the open legs. */
  totalDistanceM: number;
  geometry: RouteLineString | null;
  stops: RouteStopDto[];
  computedAt: string | null;
}

/** Which open stop may start: an IN_PROGRESS one if any, else the first open stop in route order (D-156). */
export function nextStopId(openOrdered: readonly { id: string; status: FitmentStatus }[]): string | null {
  const inProgress = openOrdered.find((s) => s.status === 'IN_PROGRESS');
  if (inProgress) return inProgress.id;
  return openOrdered.find((s) => isOpenRouteStatus(s.status))?.id ?? null;
}

/** The 409 ROUTE_ORDER message. */
export const routeOrderMessage = (tkId: string): string => `Finish or close ${tkId} first`;
