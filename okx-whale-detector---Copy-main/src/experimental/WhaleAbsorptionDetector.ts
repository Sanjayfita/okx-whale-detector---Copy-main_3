import type { Whale } from '../types/whale';
import type {
  AggressiveTrade,
  AggressiveTradeSide,
} from '../core/AggressiveTradeTracker';

export type AbsorptionType = 'BID_ABSORPTION' | 'ASK_ABSORPTION';

export interface WhaleAbsorptionEvent {
  type: AbsorptionType;

  side: 'BID' | 'ASK';

  price: number;

  whaleNotionalQuote: number;

  aggressiveSide: AggressiveTradeSide;

  aggressiveVolume: number;

  aggressiveNotionalQuote: number;

  priceChangePercent: number;

  confidence: number;

  timestamp: number;

  reason: string;
}

interface TrackedWall {
  whale: Whale;

  aggressiveVolume: number;

  aggressiveNotionalQuote: number;

  firstPrice: number;

  lastPrice: number;

  firstSeenAt: number;

  lastSeenAt: number;
}

export interface WhaleAbsorptionConfig {
  proximityPercent: number;

  minimumAggressiveNotionalQuote: number;

  minimumAggressiveVolumeRatio: number;

  maximumPriceMovementPercent: number;

  wallExpiryMs: number;
}

const DEFAULT_CONFIG: WhaleAbsorptionConfig = {
  proximityPercent: 0.1,

  minimumAggressiveNotionalQuote: 100_000,

  minimumAggressiveVolumeRatio: 0.25,

  maximumPriceMovementPercent: 0.15,

  wallExpiryMs: 60_000,
};

export class WhaleAbsorptionDetector {
  private readonly config: WhaleAbsorptionConfig;

  private trackedWalls = new Map<string, TrackedWall>();

  constructor(config: Partial<WhaleAbsorptionConfig> = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
  }

  public updateWhales(whales: Whale[], timestamp: number = Date.now()): void {
    const currentKeys = new Set<string>();

    for (const whale of whales) {
      const key = this.getKey(whale);

      currentKeys.add(key);

      const existing = this.trackedWalls.get(key);

      if (existing) {
        existing.whale = whale;
        existing.lastPrice = whale.price;
        existing.lastSeenAt = timestamp;
      } else {
        this.trackedWalls.set(key, {
          whale,

          aggressiveVolume: 0,

          aggressiveNotionalQuote: 0,

          firstPrice: whale.price,

          lastPrice: whale.price,

          firstSeenAt: timestamp,

          lastSeenAt: timestamp,
        });
      }
    }

    for (const [key, wall] of this.trackedWalls) {
      if (
        !currentKeys.has(key) &&
        timestamp - wall.lastSeenAt > this.config.wallExpiryMs
      ) {
        this.trackedWalls.delete(key);
      }
    }
  }

  public processTrade(trade: AggressiveTrade): WhaleAbsorptionEvent[] {
    const events: WhaleAbsorptionEvent[] = [];

    for (const wall of this.trackedWalls.values()) {
      if (!this.isTradeNearWall(trade, wall.whale)) {
        continue;
      }

      if (!this.isAggressiveTradeAgainstWall(trade, wall.whale)) {
        continue;
      }

      wall.aggressiveVolume += trade.size;

      wall.aggressiveNotionalQuote += trade.notionalQuote;

      const event = this.detectAbsorption(wall, trade);

      if (event) {
        events.push(event);

        this.resetAggression(wall);
      }
    }

    return events;
  }

  private detectAbsorption(
    wall: TrackedWall,
    trade: AggressiveTrade,
  ): WhaleAbsorptionEvent | null {
    const priceChangePercent = Math.abs(
      ((wall.lastPrice - wall.firstPrice) / wall.firstPrice) * 100,
    );

    const aggressiveVolumeRatio =
      wall.aggressiveNotionalQuote / wall.whale.notionalQuote;

    if (
      wall.aggressiveNotionalQuote < this.config.minimumAggressiveNotionalQuote
    ) {
      return null;
    }

    if (aggressiveVolumeRatio < this.config.minimumAggressiveVolumeRatio) {
      return null;
    }

    if (priceChangePercent > this.config.maximumPriceMovementPercent) {
      return null;
    }

    const confidence = this.calculateConfidence(
      aggressiveVolumeRatio,
      priceChangePercent,
    );

    const type: AbsorptionType =
      wall.whale.side === 'BID' ? 'BID_ABSORPTION' : 'ASK_ABSORPTION';

    return {
      type,

      side: wall.whale.side,

      price: wall.whale.price,

      whaleNotionalQuote: wall.whale.notionalQuote,

      aggressiveSide: trade.side,

      aggressiveVolume: wall.aggressiveVolume,

      aggressiveNotionalQuote: wall.aggressiveNotionalQuote,

      priceChangePercent,

      confidence,

      timestamp: Date.now(),

      reason:
        wall.whale.side === 'BID'
          ? 'Aggressive selling was absorbed by a large bid wall.'
          : 'Aggressive buying was absorbed by a large ask wall.',
    };
  }

  private isTradeNearWall(trade: AggressiveTrade, whale: Whale): boolean {
    const distancePercent = Math.abs(
      ((trade.price - whale.price) / whale.price) * 100,
    );

    return distancePercent <= this.config.proximityPercent;
  }

  private isAggressiveTradeAgainstWall(
    trade: AggressiveTrade,
    whale: Whale,
  ): boolean {
    if (whale.side === 'BID') {
      return trade.side === 'SELL';
    }

    return trade.side === 'BUY';
  }

  private calculateConfidence(
    aggressiveVolumeRatio: number,
    priceChangePercent: number,
  ): number {
    const volumeScore = Math.min(aggressiveVolumeRatio / 2, 1);

    const stabilityScore = Math.max(
      0,
      1 - priceChangePercent / this.config.maximumPriceMovementPercent,
    );

    return Math.round((volumeScore * 0.7 + stabilityScore * 0.3) * 100);
  }

  private resetAggression(wall: TrackedWall): void {
    wall.aggressiveVolume = 0;

    wall.aggressiveNotionalQuote = 0;

    wall.firstPrice = wall.lastPrice;
  }

  private getKey(whale: Whale): string {
    return `${whale.side}:${whale.price}`;
  }
}
