import { normalizeIdentifier, parseSearchId, SEARCH_MIN_CHARS, type SearchHit } from '@champ/shared';

/** Whether a query is worth sending: an id (OM/OE/TK/TT or a bare number) or at least SEARCH_MIN_CHARS characters. */
export const isSearchable = (q: string): boolean =>
  q.trim().length > 0 && (parseSearchId(q.trim()) !== null || normalizeIdentifier(q).length >= SEARCH_MIN_CHARS);

/** Where a hit opens: the task, the task with its fitment (F13 `?fitment=` link) or the travel list's sheet. */
export function hitPath(hit: SearchHit, fitmentId?: string): string {
  if (hit.kind === 'TRAVEL') return `/tasks/travel?tt=${hit.travelTaskId}`;
  return fitmentId ? `/tasks/${hit.taskId}?fitment=${fitmentId}` : `/tasks/${hit.taskId}`;
}

/**
 * The [start, end) range of `value` that matches `q`, compared in the normalized form (lower case, no spaces or
 * hyphens, D-245) and mapped back to the original characters; the whole value when the match isn't a substring
 * (e.g. `OM-112` against `OM-00112`).
 */
export function matchRange(value: string, q: string): [number, number] {
  const needle = normalizeIdentifier(q);
  const indexes: number[] = [];
  let normalized = '';
  for (let i = 0; i < value.length; i++) {
    const char = value[i]!;
    if (/[\s-]/.test(char)) continue;
    normalized += char.toLowerCase();
    indexes.push(i);
  }
  const at = needle ? normalized.indexOf(needle) : -1;
  if (at < 0) return [0, value.length];
  return [indexes[at]!, indexes[at + needle.length - 1]! + 1];
}
