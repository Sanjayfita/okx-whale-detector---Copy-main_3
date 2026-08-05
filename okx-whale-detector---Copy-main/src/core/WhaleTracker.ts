import type { OrderBook, OrderLevel } from '../types/orderbook';
import type { Whale, WhaleChange, WhaleSide } from '../types/whale';

export interface WhaleTrackerConfig {
  minimumNotionalQuote: number;
  persistentAfterSeconds: number;
  strongAfterSeconds: number;
  minimumMovementSizeRatio: number;
  maximumMovementSizeRatio: number;
  movementToleranceHighPrice: number;
  movementToleranceHigh: number;
  movementToleranceMediumPrice: number;
  movementToleranceMedium: number;
  movementToleranceLowPrice: number;
  movementToleranceLow: number;
  movementToleranceVeryLow: number;
  strengthMaximum: number;
  strengthLargeNotional: number;
  strengthLargeScore: number;
  strengthMediumNotional: number;
  strengthMediumScore: number;
  strengthSmallNotional: number;
  strengthSmallScore: number;
  strengthBaseScore: number;
  strengthOldAgeSeconds: number;
  strengthOldAgeScore: number;
  strengthMatureAgeSeconds: number;
  strengthMatureAgeScore: number;
  strengthPersistentAgeSeconds: number;
  strengthPersistentAgeScore: number;
  strengthYoungAgeSeconds: number;
  strengthYoungAgeScore: number;
}

const DEFAULT_CONFIG: WhaleTrackerConfig = {
  minimumNotionalQuote: 500_000,
  persistentAfterSeconds: 30,
  strongAfterSeconds: 60,
  minimumMovementSizeRatio: 0.8,
  maximumMovementSizeRatio: 1.2,
  movementToleranceHighPrice: 50_000,
  movementToleranceHigh: 100,
  movementToleranceMediumPrice: 1_000,
  movementToleranceMedium: 10,
  movementToleranceLowPrice: 10,
  movementToleranceLow: 0.5,
  movementToleranceVeryLow: 0.01,
  strengthMaximum: 100,
  strengthLargeNotional: 10_000_000,
  strengthLargeScore: 50,
  strengthMediumNotional: 5_000_000,
  strengthMediumScore: 40,
  strengthSmallNotional: 1_000_000,
  strengthSmallScore: 25,
  strengthBaseScore: 10,
  strengthOldAgeSeconds: 120,
  strengthOldAgeScore: 50,
  strengthMatureAgeSeconds: 60,
  strengthMatureAgeScore: 35,
  strengthPersistentAgeSeconds: 30,
  strengthPersistentAgeScore: 20,
  strengthYoungAgeSeconds: 10,
  strengthYoungAgeScore: 10,
};

export interface WhaleScanResult {
  active: Whale[];
  trackedWalls: number;
  newWalls: number;
  persistentWalls: number;
  strongWalls: number;
  totalBidNotionalQuote: number;
  totalAskNotionalQuote: number;
  strongestBid?: Whale;
  strongestAsk?: Whale;
  newWhales: Whale[];
  removedWhales: Whale[];
  movedWhales: WhaleChange[];
}

interface TrackedWall {
  whale: Whale;
  firstSeenAt: number;
  lastSeenAt: number;
  initialNotionalQuote: number;
  maxNotionalQuote: number;
  updateCount: number;
  lastPrice: number;
  seenScan: number;
  insertionOrder: number;
}

interface DisappearedWall {
  trackedWall: TrackedWall;
}

export class WhaleTracker {
  private readonly trackedWalls: Readonly<
    Record<WhaleSide, Map<number, TrackedWall>>
  > = {
    BID: new Map(),
    ASK: new Map(),
  };
  private readonly config: WhaleTrackerConfig;
  private nextWallId = 1;
  private nextInsertionOrder = 1;
  private scanNumber = 0;

  public constructor(config: WhaleTrackerConfig = DEFAULT_CONFIG) {
    this.config = config;
  }

  public scan(orderBook: OrderBook): WhaleScanResult {
    const now = Date.now();
    const currentScan = (this.scanNumber += 1);
    const currentWhales: Whale[] = [];
    const newWhales: Whale[] = [];
    const removedWhales: Whale[] = [];
    const movedWhales: WhaleChange[] = [];
    const totalBidNotionalQuote = this.processSide(
      'BID',
      orderBook.bids,
      now,
      currentScan,
      currentWhales,
      newWhales,
    );
    const totalAskNotionalQuote = this.processSide(
      'ASK',
      orderBook.asks,
      now,
      currentScan,
      currentWhales,
      newWhales,
    );

    const disappearedWalls = this.removeDisappearedWalls(currentScan);
    let movedRemovedWhales: Set<Whale> | undefined;
    let movedNewWhales: Set<Whale> | undefined;

    if (disappearedWalls && newWhales.length > 0) {
      movedRemovedWhales = new Set<Whale>();
      movedNewWhales = new Set<Whale>();

      for (const disappeared of disappearedWalls) {
        const removed = disappeared.trackedWall.whale;
        const moved = newWhales.find((candidate) => {
          if (
            movedNewWhales?.has(candidate) ||
            candidate.side !== removed.side
          ) {
            return false;
          }

          const priceDifference = Math.abs(candidate.price - removed.price);
          const sizeRatio = candidate.size / removed.size;

          return (
            priceDifference <= this.getMovementPriceTolerance(removed.price) &&
            sizeRatio >= this.config.minimumMovementSizeRatio &&
            sizeRatio <= this.config.maximumMovementSizeRatio
          );
        });

        if (!moved) {
          continue;
        }

        this.restoreMovedWhale(
          disappeared,
          removed,
          moved,
          now,
          currentScan,
          movedWhales,
        );
        movedRemovedWhales.add(removed);
        movedNewWhales.add(moved);
      }
    }

    const finalNewWhales = movedNewWhales
      ? newWhales.filter((whale) => !movedNewWhales.has(whale))
      : newWhales;

    if (disappearedWalls) {
      for (const disappeared of disappearedWalls) {
        const removed = disappeared.trackedWall.whale;
        if (!movedRemovedWhales?.has(removed)) {
          removedWhales.push(removed);
        }
      }
    }

    let persistentWalls = 0;
    let strongWalls = 0;
    let strongestBid: Whale | undefined;
    let strongestAsk: Whale | undefined;

    for (const whale of currentWhales) {
      const ageSeconds = whale.ageSeconds ?? 0;

      if (ageSeconds >= this.config.persistentAfterSeconds) {
        persistentWalls += 1;
      }
      if (ageSeconds >= this.config.strongAfterSeconds) {
        strongWalls += 1;
      }

      if (
        whale.side === 'BID' &&
        (!strongestBid || (whale.strength ?? 0) > (strongestBid.strength ?? 0))
      ) {
        strongestBid = whale;
      }

      if (
        whale.side === 'ASK' &&
        (!strongestAsk || (whale.strength ?? 0) > (strongestAsk.strength ?? 0))
      ) {
        strongestAsk = whale;
      }
    }

    return {
      active: currentWhales,
      trackedWalls: this.trackedWalls.BID.size + this.trackedWalls.ASK.size,
      newWalls: finalNewWhales.length,
      persistentWalls,
      strongWalls,
      totalBidNotionalQuote,
      totalAskNotionalQuote,
      strongestBid,
      strongestAsk,
      newWhales: finalNewWhales,
      removedWhales,
      movedWhales,
    };
  }

  public getTrackedWalls(): Whale[] {
    return [
      ...this.trackedWalls.BID.values(),
      ...this.trackedWalls.ASK.values(),
    ]
      .sort((left, right) => left.insertionOrder - right.insertionOrder)
      .map((trackedWall) => trackedWall.whale);
  }

  public reset(): void {
    this.trackedWalls.BID.clear();
    this.trackedWalls.ASK.clear();
    this.nextWallId = 1;
    this.nextInsertionOrder = 1;
    this.scanNumber = 0;
  }

  private processSide(
    side: WhaleSide,
    levels: Map<number, OrderLevel>,
    now: number,
    currentScan: number,
    currentWhales: Whale[],
    newWhales: Whale[],
  ): number {
    const trackedWalls = this.trackedWalls[side];
    let totalNotionalQuote = 0;

    for (const level of levels.values()) {
      if (level.notionalQuote < this.config.minimumNotionalQuote) {
        continue;
      }

      const existing = trackedWalls.get(level.price);

      if (!existing) {
        const whale = this.createWhale(side, level, now);
        trackedWalls.set(level.price, {
          whale,
          firstSeenAt: now,
          lastSeenAt: now,
          initialNotionalQuote: level.notionalQuote,
          maxNotionalQuote: level.notionalQuote,
          updateCount: 1,
          lastPrice: level.price,
          seenScan: currentScan,
          insertionOrder: this.nextInsertionOrder,
        });
        this.nextInsertionOrder += 1;
        currentWhales.push(whale);
        newWhales.push(whale);
      } else {
        existing.lastSeenAt = now;
        existing.updateCount += 1;
        existing.maxNotionalQuote = Math.max(
          existing.maxNotionalQuote,
          level.notionalQuote,
        );
        existing.lastPrice = level.price;
        existing.seenScan = currentScan;

        const ageSeconds = Math.floor((now - existing.firstSeenAt) / 1_000);
        const whale: Whale = {
          wallId: existing.whale.wallId,
          side,
          price: level.price,
          size: level.size,
          notionalQuote: level.notionalQuote,
          quoteCurrency: level.quoteCurrency,
          detectedAt: level.updatedAt,
          firstSeenAt: existing.firstSeenAt,
          lastSeenAt: existing.lastSeenAt,
          ageSeconds,
          updateCount: existing.updateCount,
          maxNotionalQuote: existing.maxNotionalQuote,
          strength: this.calculateStrength(level.notionalQuote, ageSeconds),
        };

        existing.whale = whale;
        currentWhales.push(whale);
      }

      totalNotionalQuote += level.notionalQuote;
    }

    return totalNotionalQuote;
  }

  private removeDisappearedWalls(
    currentScan: number,
  ): DisappearedWall[] | undefined {
    let disappearedWalls: DisappearedWall[] | undefined;

    for (const side of ['BID', 'ASK'] as const) {
      const trackedWalls = this.trackedWalls[side];

      for (const [price, trackedWall] of trackedWalls) {
        if (trackedWall.seenScan === currentScan) {
          continue;
        }

        (disappearedWalls ??= []).push({ trackedWall });
        trackedWalls.delete(price);
      }
    }

    disappearedWalls?.sort(
      (left, right) =>
        left.trackedWall.insertionOrder - right.trackedWall.insertionOrder,
    );

    return disappearedWalls;
  }

  private restoreMovedWhale(
    disappeared: DisappearedWall,
    removed: Whale,
    moved: Whale,
    now: number,
    currentScan: number,
    movedWhales: WhaleChange[],
  ): void {
    const oldTrackedWall = disappeared.trackedWall;
    const movedTrackedWall = this.trackedWalls[moved.side].get(moved.price);
    const ageSeconds = Math.floor((now - oldTrackedWall.firstSeenAt) / 1_000);
    const updateCount = oldTrackedWall.updateCount + 1;
    const maxNotionalQuote = Math.max(
      oldTrackedWall.maxNotionalQuote,
      moved.notionalQuote,
    );

    Object.assign(moved, {
      wallId: removed.wallId,
      firstSeenAt: oldTrackedWall.firstSeenAt,
      lastSeenAt: now,
      ageSeconds,
      updateCount,
      maxNotionalQuote,
      strength: this.calculateStrength(moved.notionalQuote, ageSeconds),
    });

    this.trackedWalls[moved.side].set(moved.price, {
      whale: moved,
      firstSeenAt: oldTrackedWall.firstSeenAt,
      lastSeenAt: now,
      initialNotionalQuote: oldTrackedWall.initialNotionalQuote,
      maxNotionalQuote,
      updateCount,
      lastPrice: moved.price,
      seenScan: currentScan,
      insertionOrder:
        movedTrackedWall?.insertionOrder ?? oldTrackedWall.insertionOrder,
    });
    movedWhales.push({
      wallId: removed.wallId,
      type: 'MOVED',
      side: removed.side,
      price: moved.price,
      previousPrice: removed.price,
      previousSize: removed.size,
      currentSize: moved.size,
      sizeDifference: moved.size - removed.size,
      previousNotionalQuote: removed.notionalQuote,
      currentNotionalQuote: moved.notionalQuote,
      timestamp: now,
    });
  }

  private createWhale(side: WhaleSide, level: OrderLevel, now: number): Whale {
    return {
      wallId: this.createWallId(),
      side,
      price: level.price,
      size: level.size,
      notionalQuote: level.notionalQuote,
      quoteCurrency: level.quoteCurrency,
      detectedAt: level.updatedAt,
      firstSeenAt: now,
      lastSeenAt: now,
      ageSeconds: 0,
      updateCount: 1,
      maxNotionalQuote: level.notionalQuote,
      strength: this.calculateStrength(level.notionalQuote, 0),
    };
  }

  private createWallId(): string {
    const wallId = `wall-${this.nextWallId}`;
    this.nextWallId += 1;
    return wallId;
  }

  private calculateStrength(notionalQuote: number, ageSeconds: number): number {
    let score: number;

    if (notionalQuote >= this.config.strengthLargeNotional) {
      score = this.config.strengthLargeScore;
    } else if (notionalQuote >= this.config.strengthMediumNotional) {
      score = this.config.strengthMediumScore;
    } else if (notionalQuote >= this.config.strengthSmallNotional) {
      score = this.config.strengthSmallScore;
    } else {
      score = this.config.strengthBaseScore;
    }

    if (ageSeconds >= this.config.strengthOldAgeSeconds) {
      score += this.config.strengthOldAgeScore;
    } else if (ageSeconds >= this.config.strengthMatureAgeSeconds) {
      score += this.config.strengthMatureAgeScore;
    } else if (ageSeconds >= this.config.strengthPersistentAgeSeconds) {
      score += this.config.strengthPersistentAgeScore;
    } else if (ageSeconds >= this.config.strengthYoungAgeSeconds) {
      score += this.config.strengthYoungAgeScore;
    }

    return Math.min(score, this.config.strengthMaximum);
  }

  private getMovementPriceTolerance(price: number): number {
    if (price >= this.config.movementToleranceHighPrice) {
      return this.config.movementToleranceHigh;
    }
    if (price >= this.config.movementToleranceMediumPrice) {
      return this.config.movementToleranceMedium;
    }
    if (price >= this.config.movementToleranceLowPrice) {
      return this.config.movementToleranceLow;
    }
    return this.config.movementToleranceVeryLow;
  }
}
