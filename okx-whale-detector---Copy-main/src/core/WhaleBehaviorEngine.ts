import type { Whale } from '../types/whale';
import type { WhaleRemovalAssessment } from './TradeFlowTracker';

export type WhaleBehaviorType =
  | 'SPOOF'
  | 'PERSISTENT'
  | 'REFILLING'
  | 'ACCUMULATION'
  | 'DISTRIBUTION'
  | 'LIKELY_EXECUTED'
  | 'POSSIBLE_CANCELLATION'
  | 'UNCONFIRMED_DISAPPEARANCE';

export interface WhaleBehavior {
  type: WhaleBehaviorType;
  whale: Whale;
  confidence: number;
  reason: string;
  detectedAt: number;
}

export interface WhaleBehaviorConfig {
  spoofMaxAgeSeconds: number;
  persistentMinAgeSeconds: number;
  repeatedIncreaseCount: number;
  growthMultiplier: number;
}

export interface WhaleLifecycleMetrics {
  readonly wallId: string;
  readonly firstSeenAt: number;
  readonly availabilityTimestamp: number;
  readonly lifetimeMs: number;
  readonly updateCount: number;
  readonly initialNotionalQuote: number;
  readonly currentNotionalQuote: number;
  readonly highestNotionalQuote: number;
  readonly lowestNotionalQuote: number;
  readonly increaseCount: number;
  readonly decreaseCount: number;
  readonly initialPrice: number;
  readonly currentPrice: number;
  readonly priceChangePercent: number;
  readonly notionalChangeFromInitialPercent: number;
  readonly peakDrawdownPercent: number;
  readonly recoveryFromMinimumPercent: number;
}

interface WhaleBehaviorHistory {
  firstSeenAt: number;
  lastSeenAt: number;
  updateCount: number;
  initialNotionalQuote: number;
  highestNotionalQuote: number;
  lowestNotionalQuote: number;
  previousNotionalQuote: number;
  increaseCount: number;
  decreaseCount: number;
  initialPrice: number;
  lastPrice: number;
}

const DEFAULT_CONFIG: WhaleBehaviorConfig = {
  spoofMaxAgeSeconds: 3,
  persistentMinAgeSeconds: 30,
  repeatedIncreaseCount: 3,
  growthMultiplier: 1.2,
};

export class WhaleBehaviorEngine {
  private readonly history = new Map<string, WhaleBehaviorHistory>();
  private readonly config: WhaleBehaviorConfig;

  public constructor(config: Partial<WhaleBehaviorConfig> = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
  }

  public prune(activeWhales: Whale[]): void {
    const activeKeys = new Set(activeWhales.map((whale) => this.getKey(whale)));

    for (const key of this.history.keys()) {
      if (!activeKeys.has(key)) {
        this.history.delete(key);
      }
    }
  }

  public analyze(whale: Whale): WhaleBehavior[] {
    const now = Date.now();
    const key = this.getKey(whale);
    let history = this.history.get(key);
    let created = false;

    if (!history) {
      created = true;
      history = {
        firstSeenAt: whale.firstSeenAt ?? now,
        lastSeenAt: now,
        updateCount: 1,
        initialNotionalQuote: whale.notionalQuote,
        highestNotionalQuote: whale.notionalQuote,
        lowestNotionalQuote: whale.notionalQuote,
        previousNotionalQuote: whale.notionalQuote,
        increaseCount: 0,
        decreaseCount: 0,
        initialPrice: whale.price,
        lastPrice: whale.price,
      };

      this.history.set(key, history);
    }

    const behaviors: WhaleBehavior[] = [];
    const ageSeconds =
      whale.ageSeconds ?? Math.floor((now - history.firstSeenAt) / 1000);
    const previousNotional = history.previousNotionalQuote;

    if (!created) {
      history.updateCount += 1;
    }

    if (whale.notionalQuote > previousNotional) {
      history.increaseCount++;
    }

    if (whale.notionalQuote < previousNotional) {
      history.decreaseCount++;
    }

    if (ageSeconds >= this.config.persistentMinAgeSeconds) {
      behaviors.push({
        type: 'PERSISTENT',
        whale,
        confidence: Math.min(100, 50 + ageSeconds),
        reason: `Whale has remained active for ${ageSeconds}s`,
        detectedAt: now,
      });
    }

    const hasRepeatedGrowth =
      history.increaseCount >= this.config.repeatedIncreaseCount &&
      whale.notionalQuote >
        history.lowestNotionalQuote * this.config.growthMultiplier;

    if (whale.side === 'BID' && hasRepeatedGrowth) {
      behaviors.push({
        type: 'ACCUMULATION',
        whale,
        confidence: Math.min(100, 60 + history.increaseCount * 5),
        reason: 'Bid liquidity is repeatedly increasing',
        detectedAt: now,
      });
    }

    if (whale.side === 'ASK' && hasRepeatedGrowth) {
      behaviors.push({
        type: 'DISTRIBUTION',
        whale,
        confidence: Math.min(100, 60 + history.increaseCount * 5),
        reason: 'Ask liquidity is repeatedly increasing',
        detectedAt: now,
      });
    }

    history.lastSeenAt = now;
    history.highestNotionalQuote = Math.max(
      history.highestNotionalQuote,
      whale.notionalQuote,
    );
    history.lowestNotionalQuote = Math.min(
      history.lowestNotionalQuote,
      whale.notionalQuote,
    );
    history.previousNotionalQuote = whale.notionalQuote;
    history.lastPrice = whale.price;

    return behaviors;
  }

  public getLifecycleMetrics(whale: Whale): WhaleLifecycleMetrics | undefined {
    const history = this.history.get(this.getKey(whale));
    if (!history) return undefined;
    return Object.freeze({
      wallId: whale.wallId,
      firstSeenAt: history.firstSeenAt,
      availabilityTimestamp: history.lastSeenAt,
      lifetimeMs: Math.max(0, history.lastSeenAt - history.firstSeenAt),
      updateCount: history.updateCount,
      initialNotionalQuote: history.initialNotionalQuote,
      currentNotionalQuote: history.previousNotionalQuote,
      highestNotionalQuote: history.highestNotionalQuote,
      lowestNotionalQuote: history.lowestNotionalQuote,
      increaseCount: history.increaseCount,
      decreaseCount: history.decreaseCount,
      initialPrice: history.initialPrice,
      currentPrice: history.lastPrice,
      priceChangePercent:
        ((history.lastPrice - history.initialPrice) / history.initialPrice) * 100,
      notionalChangeFromInitialPercent:
        ((history.previousNotionalQuote - history.initialNotionalQuote) /
          history.initialNotionalQuote) *
        100,
      peakDrawdownPercent:
        ((history.highestNotionalQuote - history.previousNotionalQuote) /
          history.highestNotionalQuote) *
        100,
      recoveryFromMinimumPercent:
        ((history.previousNotionalQuote - history.lowestNotionalQuote) /
          history.lowestNotionalQuote) *
        100,
    });
  }

  public analyzeRemoval(
    whale: Whale,
    assessment?: WhaleRemovalAssessment,
  ): WhaleBehavior | undefined {
    const now = Date.now();

    if (assessment) {
      return {
        type: assessment.classification,
        whale,
        confidence: assessment.confidence,
        reason: assessment.reason,
        detectedAt: now,
      };
    }

    const ageSeconds = whale.ageSeconds ?? 0;

    if (ageSeconds <= this.config.spoofMaxAgeSeconds) {
      return {
        type: 'SPOOF',
        whale,
        confidence: 85,
        reason: `Large whale disappeared after only ${ageSeconds}s`,
        detectedAt: now,
      };
    }

    return undefined;
  }

  public reset(): void {
    this.history.clear();
  }

  private getKey(whale: Whale): string {
    return whale.wallId;
  }
}
