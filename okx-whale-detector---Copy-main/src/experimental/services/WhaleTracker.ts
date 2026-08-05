import type {
  Whale,
  WhaleChange,
  WhaleChangeType,
  WhaleSide,
} from '../../types/whale';

interface TrackedWhale extends Whale {
  firstSeenAt: number;
  lastSeenAt: number;
  updateCount: number;
  maxNotionalQuote: number;
}

export interface WhaleTrackerConfig {
  priceTolerancePercent: number;
  removalTimeoutMs: number;
}

export class WhaleTracker {
  private readonly config: WhaleTrackerConfig;

  private readonly whales = new Map<string, TrackedWhale>();

  constructor(
    config: WhaleTrackerConfig = {
      priceTolerancePercent: 0.05,
      removalTimeoutMs: 5_000,
    },
  ) {
    this.config = config;
  }

  public update(incomingWhales: Whale[]): WhaleChange[] {
    const now = Date.now();

    const changes: WhaleChange[] = [];

    const matchedKeys = new Set<string>();

    for (const incoming of incomingWhales) {
      const match = this.findMatchingWhale(incoming);

      if (match) {
        const previous = { ...match.whale };

        const change = this.updateExistingWhale(match.whale, incoming, now);

        matchedKeys.add(match.key);

        if (change) {
          changes.push({
            type: change,

            side: incoming.side,

            price: incoming.price,

            previousSize: previous.size,

            currentSize: incoming.size,

            sizeDifference: incoming.size - previous.size,

            previousNotionalQuote: previous.notionalQuote,

            currentNotionalQuote: incoming.notionalQuote,

            timestamp: now,
          });
        }

        continue;
      }

      const tracked = this.createTrackedWhale(incoming, now);

      const key = this.getInternalKey(tracked);

      this.whales.set(key, tracked);

      matchedKeys.add(key);

      changes.push({
        type: 'NEW',

        side: tracked.side,

        price: tracked.price,

        previousSize: 0,

        currentSize: tracked.size,

        sizeDifference: tracked.size,

        previousNotionalQuote: 0,

        currentNotionalQuote: tracked.notionalQuote,

        timestamp: now,
      });
    }

    for (const [key, whale] of this.whales) {
      if (matchedKeys.has(key)) {
        continue;
      }

      if (now - whale.lastSeenAt >= this.config.removalTimeoutMs) {
        changes.push({
          type: 'REMOVED',

          side: whale.side,

          price: whale.price,

          previousSize: whale.size,

          currentSize: 0,

          sizeDifference: -whale.size,

          previousNotionalQuote: whale.notionalQuote,

          currentNotionalQuote: 0,

          timestamp: now,
        });

        this.whales.delete(key);
      }
    }

    return changes;
  }

  public getActiveWhales(): Whale[] {
    return Array.from(this.whales.values());
  }

  public getActiveWhalesBySide(side: WhaleSide): Whale[] {
    return this.getActiveWhales().filter((whale) => whale.side === side);
  }

  public clear(): void {
    this.whales.clear();
  }

  private findMatchingWhale(incoming: Whale): {
    key: string;
    whale: TrackedWhale;
  } | null {
    for (const [key, whale] of this.whales) {
      if (whale.side !== incoming.side) {
        continue;
      }

      const distancePercent =
        Math.abs((incoming.price - whale.price) / whale.price) * 100;

      if (distancePercent <= this.config.priceTolerancePercent) {
        return {
          key,
          whale,
        };
      }
    }

    return null;
  }

  private updateExistingWhale(
    whale: TrackedWhale,
    incoming: Whale,
    now: number,
  ): WhaleChangeType | null {
    const previousPrice = whale.price;

    const previousNotional = whale.notionalQuote;

    whale.price = incoming.price;

    whale.size = incoming.size;

    whale.notionalQuote = incoming.notionalQuote;

    whale.lastSeenAt = now;

    whale.ageSeconds = Math.floor((now - whale.firstSeenAt) / 1000);

    whale.updateCount += 1;

    whale.maxNotionalQuote = Math.max(
      whale.maxNotionalQuote,
      incoming.notionalQuote,
    );

    if (previousPrice !== incoming.price) {
      return 'MOVED';
    }

    if (incoming.notionalQuote > previousNotional) {
      return 'INCREASED';
    }

    if (incoming.notionalQuote < previousNotional) {
      return 'REDUCED';
    }

    return null;
  }

  private createTrackedWhale(whale: Whale, now: number): TrackedWhale {
    return {
      ...whale,

      firstSeenAt: now,

      lastSeenAt: now,

      updateCount: 1,

      maxNotionalQuote: whale.notionalQuote,

      ageSeconds: 0,
    };
  }

  private getInternalKey(whale: Whale): string {
    return `${whale.side}:` + `${whale.price}`;
  }
}
