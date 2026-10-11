/** A small LRU cache with a per-entry time to live. `now` is injectable for tests. */
export class LruCache<K, V> {
  private readonly entries = new Map<K, { value: V; expiresAt: number }>();

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  has(key: K): boolean {
    return this.lookup(key) !== undefined;
  }

  get(key: K): V | undefined {
    return this.lookup(key)?.value;
  }

  set(key: K, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    // Map keeps insertion order: the first key is the least recently used.
    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value as K);
    }
  }

  private lookup(key: K) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (entry.expiresAt <= this.now()) return undefined;
    this.entries.set(key, entry); // mark as most recently used
    return entry;
  }
}
