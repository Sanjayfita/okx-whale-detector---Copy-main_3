import type { Whale } from '../types/whale';

export interface WhaleRefillEvent {
  whale: Whale;
  refillCount: number;
  previousNotionalQuote: number;
  currentNotionalQuote: number;
  refillAmountQuote: number;
  timestamp: number;
}

interface WhaleRefillHistory {
  baselineNotionalQuote: number;
  lastNotionalQuote: number;
  lowestNotionalQuote: number;
  refillCount: number;
  inDrawdown: boolean;
}

export interface WhaleRefillConfig {
  dropThresholdPercent: number;
  recoveryThresholdPercent: number;
}

const DEFAULT_CONFIG: WhaleRefillConfig = {
  dropThresholdPercent: 10,
  recoveryThresholdPercent: 90,
};

export class WhaleRefillDetector {
  private readonly history = new Map<string, WhaleRefillHistory>();
  private readonly config: WhaleRefillConfig;

  public constructor(config: Partial<WhaleRefillConfig> = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
  }

  public detect(whale: Whale): WhaleRefillEvent | undefined {
    const key = this.getKey(whale);
    const current = whale.notionalQuote;
    const existing = this.history.get(key);

    if (!existing) {
      this.history.set(key, {
        baselineNotionalQuote: current,
        lastNotionalQuote: current,
        lowestNotionalQuote: current,
        refillCount: 0,
        inDrawdown: false,
      });

      return undefined;
    }

    if (!existing.inDrawdown) {
      existing.baselineNotionalQuote = Math.max(
        existing.baselineNotionalQuote,
        current,
      );

      const dropPercent =
        ((existing.baselineNotionalQuote - current) /
          existing.baselineNotionalQuote) *
        100;

      if (dropPercent >= this.config.dropThresholdPercent) {
        existing.inDrawdown = true;
        existing.lowestNotionalQuote = current;
      }

      existing.lastNotionalQuote = current;
      return undefined;
    }

    existing.lowestNotionalQuote = Math.min(
      existing.lowestNotionalQuote,
      current,
    );

    const recoveryTarget =
      existing.baselineNotionalQuote *
      (this.config.recoveryThresholdPercent / 100);
    const isRecovering = current > existing.lastNotionalQuote;

    if (!isRecovering || current < recoveryTarget) {
      existing.lastNotionalQuote = current;
      return undefined;
    }

    const refillAmountQuote = current - existing.lowestNotionalQuote;

    existing.refillCount += 1;
    existing.baselineNotionalQuote = current;
    existing.lastNotionalQuote = current;
    existing.lowestNotionalQuote = current;
    existing.inDrawdown = false;

    return {
      whale,
      refillCount: existing.refillCount,
      previousNotionalQuote: current - refillAmountQuote,
      currentNotionalQuote: current,
      refillAmountQuote,
      timestamp: Date.now(),
    };
  }

  public getRefillCount(whale: Whale): number {
    return this.history.get(this.getKey(whale))?.refillCount ?? 0;
  }

  public prune(activeWhales: Whale[]): void {
    const activeKeys = new Set(activeWhales.map((whale) => this.getKey(whale)));

    for (const key of this.history.keys()) {
      if (!activeKeys.has(key)) {
        this.history.delete(key);
      }
    }
  }

  public reset(): void {
    this.history.clear();
  }

  private getKey(whale: Whale): string {
    return whale.wallId;
  }
}
