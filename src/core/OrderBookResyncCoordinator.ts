export interface OrderBookResyncSnapshot {
  readonly symbol: string;
  readonly attempts: number;
  readonly waitingForSnapshot: boolean;
}

export interface OrderBookResyncCoordinatorOptions {
  readonly maximumAttempts?: number;
  readonly baseBackoffMs?: number;
  readonly snapshotTimeoutMs?: number;
  readonly schedule?: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  readonly cancelScheduled?: (handle: ReturnType<typeof setTimeout>) => void;
  readonly onAttempt?: (symbol: string, attempt: number) => void;
  readonly onRecovered?: (symbol: string, attempts: number) => void;
  readonly onFailed?: (symbol: string, attempts: number, error?: unknown) => void;
}

interface ResyncState {
  attempts: number;
  retryTimer?: ReturnType<typeof setTimeout>;
  snapshotTimer?: ReturnType<typeof setTimeout>;
  waitingForSnapshot: boolean;
}

const DEFAULT_MAXIMUM_ATTEMPTS = 4;
const DEFAULT_BASE_BACKOFF_MS = 250;
const DEFAULT_SNAPSHOT_TIMEOUT_MS = 5_000;

export class OrderBookResyncCoordinator {
  private readonly states = new Map<string, ResyncState>();
  private readonly maximumAttempts: number;
  private readonly baseBackoffMs: number;
  private readonly snapshotTimeoutMs: number;
  private readonly schedule: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  private readonly cancelScheduled: (
    handle: ReturnType<typeof setTimeout>,
  ) => void;
  private closed = false;

  public constructor(
    private readonly resubscribe: (symbol: string) => void,
    private readonly options: OrderBookResyncCoordinatorOptions = {},
  ) {
    this.maximumAttempts =
      options.maximumAttempts ?? DEFAULT_MAXIMUM_ATTEMPTS;
    this.baseBackoffMs = options.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
    this.snapshotTimeoutMs =
      options.snapshotTimeoutMs ?? DEFAULT_SNAPSHOT_TIMEOUT_MS;
    this.schedule = options.schedule ?? setTimeout;
    this.cancelScheduled = options.cancelScheduled ?? clearTimeout;

    if (!Number.isInteger(this.maximumAttempts) || this.maximumAttempts <= 0) {
      throw new Error('maximumAttempts must be a positive integer');
    }
    if (!Number.isFinite(this.baseBackoffMs) || this.baseBackoffMs < 0) {
      throw new Error('baseBackoffMs must be a non-negative number');
    }
    if (!Number.isFinite(this.snapshotTimeoutMs) || this.snapshotTimeoutMs <= 0) {
      throw new Error('snapshotTimeoutMs must be greater than 0');
    }
  }

  public request(symbol: string): boolean {
    if (this.closed) {
      return false;
    }

    const normalizedSymbol = symbol.trim();
    if (normalizedSymbol.length === 0) {
      throw new Error('symbol must not be empty');
    }

    if (this.states.has(normalizedSymbol)) {
      return false;
    }

    this.states.set(normalizedSymbol, {
      attempts: 0,
      waitingForSnapshot: false,
    });
    this.scheduleAttempt(normalizedSymbol, 0);
    return true;
  }

  public complete(symbol: string): boolean {
    const state = this.states.get(symbol);
    if (!state) {
      return false;
    }

    this.cancelStateTimers(state);
    this.states.delete(symbol);
    this.options.onRecovered?.(symbol, state.attempts);
    return true;
  }

  public isPending(symbol: string): boolean {
    return this.states.has(symbol);
  }

  public getSnapshot(): readonly OrderBookResyncSnapshot[] {
    return [...this.states.entries()]
      .map(([symbol, state]) => ({
        symbol,
        attempts: state.attempts,
        waitingForSnapshot: state.waitingForSnapshot,
      }))
      .sort((left, right) => left.symbol.localeCompare(right.symbol));
  }

  public close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    for (const state of this.states.values()) {
      this.cancelStateTimers(state);
    }
    this.states.clear();
  }

  private scheduleAttempt(symbol: string, delayMs: number): void {
    const state = this.states.get(symbol);
    if (!state || this.closed) {
      return;
    }

    if (state.retryTimer) {
      this.cancelScheduled(state.retryTimer);
    }

    state.retryTimer = this.schedule(() => {
      state.retryTimer = undefined;
      this.attempt(symbol);
    }, delayMs);
  }

  private attempt(symbol: string): void {
    const state = this.states.get(symbol);
    if (!state || this.closed) {
      return;
    }

    state.attempts += 1;
    state.waitingForSnapshot = false;
    this.options.onAttempt?.(symbol, state.attempts);

    try {
      this.resubscribe(symbol);
    } catch (error: unknown) {
      this.retryOrFail(symbol, error);
      return;
    }

    const currentState = this.states.get(symbol);
    if (!currentState || this.closed) {
      return;
    }

    currentState.waitingForSnapshot = true;
    currentState.snapshotTimer = this.schedule(() => {
      currentState.snapshotTimer = undefined;
      currentState.waitingForSnapshot = false;
      this.retryOrFail(symbol);
    }, this.snapshotTimeoutMs);
  }

  private retryOrFail(symbol: string, error?: unknown): void {
    const state = this.states.get(symbol);
    if (!state || this.closed) {
      return;
    }

    if (state.snapshotTimer) {
      this.cancelScheduled(state.snapshotTimer);
      state.snapshotTimer = undefined;
    }
    state.waitingForSnapshot = false;

    if (state.attempts >= this.maximumAttempts) {
      this.cancelStateTimers(state);
      this.states.delete(symbol);
      this.options.onFailed?.(symbol, state.attempts, error);
      return;
    }

    const delayMs = this.baseBackoffMs * 2 ** Math.max(0, state.attempts - 1);
    this.scheduleAttempt(symbol, delayMs);
  }

  private cancelStateTimers(state: ResyncState): void {
    if (state.retryTimer) {
      this.cancelScheduled(state.retryTimer);
      state.retryTimer = undefined;
    }
    if (state.snapshotTimer) {
      this.cancelScheduled(state.snapshotTimer);
      state.snapshotTimer = undefined;
    }
    state.waitingForSnapshot = false;
  }
}
