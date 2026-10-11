const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs tasks one at a time, starting each at least `intervalMs` after the previous one started
 * (Nominatim's usage policy allows at most 1 request per second).
 */
export class SerialThrottle {
  private tail: Promise<unknown> = Promise.resolve();
  private lastStart = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly intervalMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      const wait = this.lastStart + this.intervalMs - this.now();
      if (wait > 0) await sleep(wait);
      this.lastStart = this.now();
      return task();
    });
    // The next task waits for this one to settle, whether it succeeds or not.
    this.tail = result.catch(() => undefined);
    return result;
  }
}
