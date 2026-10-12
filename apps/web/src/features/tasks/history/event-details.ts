/** Keys whose arrays are lists, not `[before, after]` diffs (reopen attributions; F06 photo ids and kinds). */
const LIST_KEYS = new Set(['attributions', 'photoIds', 'kinds']);

/** `{ field: [before, after] }` entries and other values of an event's data, as readable lines. */
export function eventDetails(data: unknown): { key: string; before?: string; after?: string; value?: string }[] {
  if (!data || typeof data !== 'object') return [];
  const show = (v: unknown): string =>
    v === null || v === undefined || v === ''
      ? '—'
      : Array.isArray(v) && v.every((x) => typeof x === 'string')
        ? v.join(', ')
        : typeof v === 'object'
          ? JSON.stringify(v)
          : String(v);
  return Object.entries(data as Record<string, unknown>).map(([key, value]) =>
    Array.isArray(value) && value.length === 2 && !LIST_KEYS.has(key)
      ? { key, before: show(value[0]), after: show(value[1]) }
      : { key, value: show(value) },
  );
}
