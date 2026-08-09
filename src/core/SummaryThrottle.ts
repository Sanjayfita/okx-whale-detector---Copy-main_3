export class SummaryThrottle {
  private readonly lastDisplayTimes = new Map<string, number>();

  constructor(private readonly intervalMs: number = 5_000) {}

  public shouldDisplay(symbol: string, now: number = Date.now()): boolean {
    const lastDisplayTime = this.lastDisplayTimes.get(symbol);

    /*
     * A symbol that has never been
     * displayed should be allowed
     * immediately.
     */
    if (
      lastDisplayTime !== undefined &&
      now - lastDisplayTime < this.intervalMs
    ) {
      return false;
    }

    this.lastDisplayTimes.set(symbol, now);

    return true;
  }

  public reset(symbol?: string): void {
    if (symbol !== undefined) {
      this.lastDisplayTimes.delete(symbol);

      return;
    }

    this.lastDisplayTimes.clear();
  }
}
