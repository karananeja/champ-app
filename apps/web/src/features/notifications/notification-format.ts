import { formatIst } from '@/lib/format';

/** "Just now", "5 min ago", "3 h ago", then the IST date and time. */
export function notificationTime(iso: string, now = Date.now()): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`;
  return formatIst(iso);
}

/** The badge text: the count, capped at "9+". */
export const badgeText = (count: number) => (count > 9 ? '9+' : String(count));
