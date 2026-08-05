import type { WhaleBehavior } from '../core/WhaleBehaviorEngine';
import type { WhaleEvent, WhaleEventType } from '../core/WhaleEventDetector';
import type { WhaleRefillEvent } from '../core/WhaleRefillDetector';
import type { MarketSummaryInput } from '../reporting/MarketReporter';
import { MarketReporter } from '../reporting/MarketReporter';
import type { WhaleChange } from '../types/whale';

export interface ReplayEventTotals {
  sequenceGaps: number;
  whaleEvents: Record<WhaleEventType, number>;
  movedWhales: number;
  refillEvents: number;
  spoofEvents: number;
  behaviorEvents: Record<string, number>;
  summaries: number;
}

const createWhaleEventTotals = (): Record<WhaleEventType, number> => ({
  NEW: 0,
  REMOVED: 0,
  INCREASED: 0,
  DECREASED: 0,
  MOVED: 0,
});

export class ReplayAnalyticsReporter extends MarketReporter {
  private readonly totals: ReplayEventTotals = {
    sequenceGaps: 0,
    whaleEvents: createWhaleEventTotals(),
    movedWhales: 0,
    refillEvents: 0,
    spoofEvents: 0,
    behaviorEvents: {},
    summaries: 0,
  };

  public override reportSequenceGap(_symbol: string): void {
    this.totals.sequenceGaps += 1;
  }

  public override reportBehavior(behavior: WhaleBehavior): void {
    this.totals.behaviorEvents[behavior.type] =
      (this.totals.behaviorEvents[behavior.type] ?? 0) + 1;
  }

  public override reportSpoof(_symbol: string, _spoof: WhaleBehavior): void {
    this.totals.spoofEvents += 1;
  }

  public override reportWhaleEvent(_symbol: string, event: WhaleEvent): void {
    this.totals.whaleEvents[event.type] += 1;
  }

  public override reportRefill(
    _symbol: string,
    _refill: WhaleRefillEvent,
  ): void {
    this.totals.refillEvents += 1;
  }

  public override reportMovedWhale(_symbol: string, _moved: WhaleChange): void {
    this.totals.movedWhales += 1;
  }

  public override reportSummary(_input: MarketSummaryInput): void {
    this.totals.summaries += 1;
  }

  public getTotals(): ReplayEventTotals {
    return {
      ...this.totals,
      whaleEvents: { ...this.totals.whaleEvents },
      behaviorEvents: { ...this.totals.behaviorEvents },
    };
  }
}
