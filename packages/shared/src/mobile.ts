import { z } from 'zod';
import type { AuthResponse } from './dto';
import type { Role } from './roles';
import type { FitmentStatus } from './tasks';

// --- Field app (F09) ---

/** Roles that may sign in to the field app (D-128). */
export const MOBILE_ROLES = ['OT', 'OE'] as const satisfies readonly Role[];
/** Roles that must set a home location before using the app (D-129; OE optional). */
export const HOME_LOCATION_REQUIRED_ROLES = ['OT'] as const satisfies readonly Role[];
/** Past IST days the app may show besides today (D-029). */
export const MOBILE_PAST_DAYS = 7;

export const MOBILE_ROLE_NOT_ALLOWED_MESSAGE = 'Use the Champ web console';

export const isMobileRole = (role: Role): boolean => (MOBILE_ROLES as readonly Role[]).includes(role);
export const isHomeLocationRequired = (role: Role): boolean => (HOME_LOCATION_REQUIRED_ROLES as readonly Role[]).includes(role);

export interface HomeLocationDto {
  lat: number;
  lng: number;
  address: string;
  updatedAt: string;
}

export const setHomeLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().trim().min(3, 'Enter an address').max(300, 'Address is too long'),
});
export type SetHomeLocationInput = z.infer<typeof setHomeLocationSchema>;

export interface MobileAuthResponse extends AuthResponse {
  refreshToken: string;
}

/** Body of `POST /mobile/auth/refresh` and `/mobile/auth/logout`. */
export const mobileRefreshSchema = z.object({ refreshToken: z.string().min(1) });
export type MobileRefreshInput = z.infer<typeof mobileRefreshSchema>;

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** IST calendar days the app may show: today and the MOBILE_PAST_DAYS before it, newest first. */
export function mobileDateOptions(now: Date): string[] {
  const istMidnightAsUtc = Math.floor((now.getTime() + IST_OFFSET_MS) / DAY_MS) * DAY_MS;
  return Array.from({ length: MOBILE_PAST_DAYS + 1 }, (_, i) =>
    new Date(istMidnightAsUtc - i * DAY_MS).toISOString().slice(0, 10),
  );
}

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const mobileDateQuerySchema = z.object({
  date: isoDay.refine((d) => mobileDateOptions(new Date()).includes(d), {
    message: `Choose today or one of the last ${MOBILE_PAST_DAYS} days`,
  }),
});
export type MobileDateQuery = z.infer<typeof mobileDateQuerySchema>;

export interface MobileHomeResponse {
  /** YYYY-MM-DD (IST). */
  date: string;
  /** My fitments on that day. */
  showTasks: number;
  /** OE: SUBMITTED fitments on that day I may verify; OT: null. */
  approveVisit: number | null;
}

export interface MyFitmentDto {
  id: string;
  /** TK-00012 */
  tkId: string;
  status: FitmentStatus;
  /** UTC ISO, shown in IST. */
  fitmentAt: string;
  /** Client name. */
  customer: string;
  site: { name: string; address: string | null; lat: number | null; lng: number | null };
  vehicleRegNo: string | null;
  activity: string;
}

export interface MyFitmentsResponse {
  date: string;
  items: MyFitmentDto[];
}
