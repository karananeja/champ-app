import type { FitmentStatus, TaskStatus } from '@champ/shared';

/**
 * Badge colours (CR-03): one tone map, with light and dark values, used by every status badge so the same
 * state always looks the same. `STATUS_TONES` maps workflow statuses to tones (badges and board columns).
 */
export const TONES = {
  amber: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200',
  sky: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200',
  violet: 'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-200',
  blue: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200',
  teal: 'border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-900 dark:bg-teal-950 dark:text-teal-200',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  neutral: 'border-neutral-200 bg-neutral-100 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300',
  red: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200',
  orange: 'border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-900 dark:bg-orange-950 dark:text-orange-200',
} as const;
export type Tone = keyof typeof TONES;

/** One colour per workflow status, used for task and fitment badges across the app (F05). */
export const STATUS_TONES: Record<FitmentStatus | TaskStatus, string> = {
  OPEN: TONES.amber,
  ASSIGNED: TONES.sky,
  IN_PROGRESS: TONES.violet,
  SUBMITTED: TONES.blue,
  OE_VERIFIED: TONES.teal,
  OM_APPROVED: TONES.emerald,
  COMPLETED: TONES.emerald,
  CLOSED_NOT_DONE: TONES.neutral,
  MOVED_TO_FT: TONES.red,
  REOPENED: TONES.orange,
};
