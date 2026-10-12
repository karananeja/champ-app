/** F12: query keys and the distance wording of the History tab and Approve visit. */
export const historyQueryKey = (date: string, userId?: string) => ['mobile-history', date, userId ?? 'me'] as const;
export const reporteesQueryKey = (date: string) => ['mobile-history', 'reportees', date] as const;
export const approveVisitListKey = (date: string) => ['mobile-approve-visit', date] as const;
export const approveVisitDetailKey = (id: string) => ['mobile-approve-visit', 'detail', id] as const;

/** 42_600 → "42.6 km". */
export const formatKm = (m: number): string => `${(m / 1000).toFixed(1)} km`;

/** "42.6 km" or "≈ 42.6 km (approx.)" when the distance is straight-line (D-216). */
export const formatDistance = (m: number, approx: boolean): string => (approx ? `≈ ${formatKm(m)} (approx.)` : formatKm(m));

export const fitmentCount = (n: number): string => `${n} ${n === 1 ? 'fitment' : 'fitments'}`;
