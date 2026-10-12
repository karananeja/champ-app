/**
 * F10B §6 "Read text": turns the lines recognised on a device label into device-id candidates. A candidate is an
 * alphanumeric run of 6 or more characters; duplicates (ignoring case) are dropped and the longest come first
 * (ties keep the order they were read in).
 */
export const MIN_CANDIDATE_LENGTH = 6;
export const MAX_CANDIDATES = 8;

export function textCandidates(lines: readonly string[], max: number = MAX_CANDIDATES): string[] {
  const seen = new Set<string>();
  const found: string[] = [];
  const run = new RegExp(`[A-Za-z0-9]{${MIN_CANDIDATE_LENGTH},}`, 'g');
  for (const line of lines) {
    for (const match of line.match(run) ?? []) {
      const key = match.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(match);
    }
  }
  // Array.prototype.sort is stable, so equal lengths keep reading order.
  return found.sort((a, b) => b.length - a.length).slice(0, max);
}
