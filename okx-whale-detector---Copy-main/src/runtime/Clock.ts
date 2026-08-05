export interface Clock {
  now(): number;
}

export class SystemClock implements Clock {
  public now(): number {
    return Date.now();
  }
}

export class ManualClock implements Clock {
  public constructor(private currentTimeMs = 0) {
    this.assertTime(currentTimeMs);
  }

  public now(): number {
    return this.currentTimeMs;
  }

  public set(timeMs: number): void {
    this.assertTime(timeMs);
    if (timeMs < this.currentTimeMs) {
      throw new Error('ManualClock cannot move backwards');
    }
    this.currentTimeMs = timeMs;
  }

  public advance(milliseconds: number): number {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new Error('milliseconds must be a non-negative number');
    }
    this.currentTimeMs += milliseconds;
    return this.currentTimeMs;
  }

  private assertTime(value: number): void {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error('time must be non-negative UTC epoch milliseconds');
    }
  }
}

export class ReplayClock implements Clock {
  private readonly manualClock: ManualClock;
  private initialized = false;
  private restoreDateNow?: () => void;

  public constructor(initialTimeMs = 0) {
    this.manualClock = new ManualClock(initialTimeMs);
    this.initialized = initialTimeMs > 0;
  }

  public now(): number {
    return this.manualClock.now();
  }

  public observe(recordedAt: number): number {
    if (!Number.isFinite(recordedAt) || recordedAt < 0) {
      throw new Error('recordedAt must be non-negative UTC epoch milliseconds');
    }

    if (!this.initialized) {
      this.manualClock.set(recordedAt);
      this.initialized = true;
      return this.manualClock.now();
    }

    if (recordedAt < this.manualClock.now()) {
      throw new Error('Replay records must be chronological');
    }

    this.manualClock.set(recordedAt);
    return this.manualClock.now();
  }

  public installDateNow(): () => void {
    if (this.restoreDateNow) {
      return this.restoreDateNow;
    }

    const originalDateNow = Date.now;
    const restore = (): void => {
      if (Date.now !== originalDateNow) {
        Date.now = originalDateNow;
      }
      this.restoreDateNow = undefined;
    };

    Date.now = () => this.now();
    this.restoreDateNow = restore;
    return restore;
  }
}

export const clockNow = (clock: Clock): (() => number) => () => clock.now();
