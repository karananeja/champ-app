import { z } from 'zod';
import type { FitmentPhotoDto, FitmentVerificationDto } from './dto';
import type { FitmentFormDto } from './fitment-form';
import { mobileDateQuerySchema } from './mobile';
import type { Role } from './roles';
import type { FitmentStatus } from './tasks';
import type { FitmentAction } from './workflow';

// --- Field app history and Approve visit (F12) ---

export type TimelineStepKind = 'STARTED' | 'SUBMITTED' | 'CLOSED_NOT_DONE' | 'MOVED_TO_FT';

export interface TimelineStep {
  kind: TimelineStepKind;
  /** UTC ISO. */
  at: string;
  /** 'Started', 'Submitted', 'Closed – not done: <reason>', 'Moved to FT'. */
  label: string;
}

export interface TimelineEntryDto {
  fitmentId: string;
  tkId: string;
  status: FitmentStatus;
  customer: string;
  site: { name: string; address: string | null };
  vehicleRegNo: string | null;
  /** That day's steps, oldest first. */
  steps: TimelineStep[];
  /** Driving distance from the previous started entry's start position; null for the first started entry and for entries not started. */
  legFromPreviousM: number | null;
  started: boolean;
}

export interface DayHistoryDto {
  /** YYYY-MM-DD (IST). */
  date: string;
  user: { id: string; name: string; role: Role };
  /** D-216. */
  distanceM: number;
  /** true when the distance is straight-line (routing unavailable). */
  approx: boolean;
  startedCount: number;
  /** Ordered by first step time. */
  entries: TimelineEntryDto[];
}

export interface ReporteeDayDto {
  user: { id: string; name: string; phone: string | null };
  startedCount: number;
  distanceM: number;
  approx: boolean;
}

/** Items by name. */
export interface ReporteesHistoryResponse {
  date: string;
  items: ReporteeDayDto[];
}

export const historyQuerySchema = mobileDateQuerySchema.extend({ userId: z.string().min(1).optional() });
export type HistoryQuery = z.infer<typeof historyQuerySchema>;

export interface ApproveVisitItemDto {
  fitmentId: string;
  tkId: string;
  customer: string;
  site: { name: string; address: string | null };
  technician: { id: string; name: string } | null;
  vehicleRegNo: string | null;
  /** UTC ISO. */
  submittedAt: string | null;
}

/** Items by submittedAt ascending. */
export interface ApproveVisitListResponse {
  date: string;
  items: ApproveVisitItemDto[];
}

export interface ApproveVisitDetailDto {
  item: ApproveVisitItemDto;
  status: FitmentStatus;
  isVehicle: boolean;
  form: FitmentFormDto;
  /** Active technician photos, presigned. */
  photos: FitmentPhotoDto[];
  /** The existing F06 DTO. */
  verification: FitmentVerificationDto;
  /** UTC ISO. */
  startedAt: string | null;
  /** VERIFY / REOPEN for the caller. */
  availableActions: FitmentAction[];
}
