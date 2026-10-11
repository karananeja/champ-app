/** `{ field: [before, after] }` entries and other values of an event's data, as readable lines. */
export function eventDetails(data: unknown): { key: string; before?: string; after?: string; value?: string }[] {
  if (!data || typeof data !== 'object') return [];
  const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return Object.entries(data as Record<string, unknown>).map(([key, value]) =>
    Array.isArray(value) && value.length === 2 && key !== 'attributions'
      ? { key, before: show(value[0]), after: show(value[1]) }
      : { key, value: show(value) },
  );
}
