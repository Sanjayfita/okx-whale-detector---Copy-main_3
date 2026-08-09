import type { Whale } from '../types/whale';

export type WhaleEventType =
  'NEW' | 'REMOVED' | 'INCREASED' | 'DECREASED' | 'MOVED';

export interface WhaleEvent {
  type: WhaleEventType;
  whale: Whale;
  previous?: Whale;
}

export interface WhaleEventDetectorConfig {
  removalGraceMs: number;
  minimumChangePercent: number;
  minimumChangeNotional: number;
}

interface TrackedWhale {
  whale: Whale;
  lastSeen: number;
}

export class WhaleEventDetector {
  private readonly previousWhales = new Map<string, TrackedWhale>();

  public constructor(
    private readonly config: WhaleEventDetectorConfig = {
      removalGraceMs: 2_000,
      minimumChangePercent: 10,
      minimumChangeNotional: 100_000,
    },
  ) {}

  public detect(currentWhales: Whale[]): WhaleEvent[] {
    const now = Date.now();
    const events: WhaleEvent[] = [];
    const activeIds = new Set<string>();

    for (const whale of currentWhales) {
      activeIds.add(whale.wallId);

      const previous = this.previousWhales.get(whale.wallId);

      if (!previous) {
        events.push({
          type: 'NEW',
          whale,
        });

        this.previousWhales.set(whale.wallId, {
          whale,
          lastSeen: now,
        });

        continue;
      }

      if (previous.whale.price !== whale.price) {
        events.push({
          type: 'MOVED',
          whale,
          previous: previous.whale,
        });
      }

      const change = whale.notionalQuote - previous.whale.notionalQuote;
      const changePercent =
        previous.whale.notionalQuote === 0
          ? 0
          : Math.abs(change / previous.whale.notionalQuote) * 100;

      if (
        changePercent >= this.config.minimumChangePercent &&
        Math.abs(change) >= this.config.minimumChangeNotional
      ) {
        events.push({
          type: change > 0 ? 'INCREASED' : 'DECREASED',
          whale,
          previous: previous.whale,
        });
      }

      this.previousWhales.set(whale.wallId, {
        whale,
        lastSeen: now,
      });
    }

    for (const [wallId, tracked] of this.previousWhales) {
      if (activeIds.has(wallId)) {
        continue;
      }

      const timeSinceLastSeen = now - tracked.lastSeen;

      if (timeSinceLastSeen < this.config.removalGraceMs) {
        continue;
      }

      events.push({
        type: 'REMOVED',
        whale: tracked.whale,
      });

      this.previousWhales.delete(wallId);
    }

    return events;
  }

  public reset(): void {
    this.previousWhales.clear();
  }
}
