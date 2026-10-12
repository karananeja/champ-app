import { IST_TIME_ZONE, type NotificationType } from '@champ/shared';

/** The texts of every notification (F13): one place, so the web and the app show the same words. */

const istShort = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/** `14 Oct, 10:00 am` (IST). */
export function formatIstShort(date: Date): string {
  const parts = Object.fromEntries(istShort.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.day} ${parts.month}, ${parts.hour}:${parts.minute} ${String(parts.dayPeriod).toLowerCase()}`;
}

export type FitmentNotificationType = Exclude<NotificationType, 'TRAVEL_RAISED' | 'TRAVEL_VERIFIED'>;

const SUFFIX: Record<FitmentNotificationType, (actor: string) => string> = {
  FITMENT_ASSIGNED: () => 'assigned to you',
  FITMENT_UNASSIGNED: () => 'reassigned',
  FITMENT_SUBMITTED: (a) => `submitted by ${a}`,
  FITMENT_VERIFIED: (a) => `verified by ${a}`,
  FITMENT_APPROVED: () => 'approved',
  FITMENT_REOPENED: (a) => `reopened by ${a}`,
  FITMENT_MOVED_TO_FT: (a) => `moved to FT by ${a}`,
};

const SINGLE_TAIL: Partial<Record<FitmentNotificationType, string>> = {
  FITMENT_SUBMITTED: ' · ready to verify',
  FITMENT_VERIFIED: ' · ready for final approval',
};

/**
 * "TK-00012 submitted by Arjun · ready to verify" for one fitment, "5 fitments of OM-00012 submitted by Arjun"
 * for a group.
 */
export function fitmentTitle(type: FitmentNotificationType, opts: { count: number; tkId: string; omId: string; actorName: string }): string {
  const suffix = SUFFIX[type](opts.actorName);
  if (opts.count > 1) {
    const verb = type === 'FITMENT_UNASSIGNED' ? 'were ' : '';
    return `${opts.count} fitments of ${opts.omId} ${verb}${suffix}`;
  }
  const verb = type === 'FITMENT_UNASSIGNED' ? 'was ' : '';
  return `${opts.tkId} ${verb}${suffix}${SINGLE_TAIL[type] ?? ''}`;
}

/** Customer · site, plus the fitment time for an assignment. */
export function taskContext(task: { clientName: string; siteName: string; fitmentAt: Date }, withTime: boolean): string {
  const parts = [task.clientName, task.siteName];
  if (withTime) parts.push(formatIstShort(task.fitmentAt));
  return parts.join(' · ');
}

export const replacementBody = (tkIds: string[]) =>
  tkIds.length === 1 ? `Replacement ${tkIds[0]} created` : `Replacements ${tkIds.join(', ')} created`;

export const travelTitle = (type: 'TRAVEL_RAISED' | 'TRAVEL_VERIFIED', ttId: string, actorName: string) =>
  type === 'TRAVEL_RAISED' ? `Travel task ${ttId} raised by ${actorName}` : `Travel task ${ttId} verified by ${actorName}`;
