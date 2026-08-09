import type { OrderBook, OrderLevel } from '../types/orderbook';

import { WallStatus, WallSide, type Wall } from '../types/wall';

export interface WallDetectorConfig {
  minNotionalQuote: number;
  persistentAfterMs: number;
  strongAfterMs: number;
  priceTolerancePercent: number;
  removalGracePeriodMs: number;
}

interface SideWallIndex {
  readonly walls: Wall[];
  readonly byCurrentPrice: Map<number, Wall>;
}

export class WallDetector {
  private readonly walls = new Map<string, Wall>();
  private readonly matchedWalls = new Set<Wall>();
  private readonly sideIndexes: Record<WallSide, SideWallIndex> = {
    [WallSide.BUY]: {
      walls: [],
      byCurrentPrice: new Map(),
    },
    [WallSide.SELL]: {
      walls: [],
      byCurrentPrice: new Map(),
    },
  };

  private readonly config: WallDetectorConfig;

  constructor(
    config: WallDetectorConfig = {
      minNotionalQuote: 500_000,
      persistentAfterMs: 30_000,
      strongAfterMs: 120_000,
      priceTolerancePercent: 0.1,
      removalGracePeriodMs: 2_000,
    },
  ) {
    this.config = config;
  }

  public detect(orderBook: OrderBook): Wall[] {
    this.matchedWalls.clear();
    const now = Date.now();

    this.processSide(
      WallSide.BUY,
      orderBook.bids,
      this.sideIndexes[WallSide.BUY],
      now,
    );

    this.processSide(
      WallSide.SELL,
      orderBook.asks,
      this.sideIndexes[WallSide.SELL],
      now,
    );

    this.removeMissingWalls(now);

    return [...this.walls.values()];
  }

  private processSide(
    side: WallSide,
    levels: Map<number, OrderLevel>,
    index: SideWallIndex,
    now: number,
  ): void {
    let currentPriceIndexChanged = false;

    for (const level of levels.values()) {
      if (level.notionalQuote < this.config.minNotionalQuote) {
        continue;
      }

      const exactWall = index.byCurrentPrice.get(level.price);
      const existingWall =
        exactWall && !this.matchedWalls.has(exactWall)
          ? exactWall
          : this.findNearbyWall(level.price, index.walls);

      if (existingWall) {
        this.matchedWalls.add(existingWall);

        if (existingWall.currentPrice !== level.price) {
          currentPriceIndexChanged = true;
        }

        this.updateWall(existingWall, level, now);
        continue;
      }

      const wallId = this.createWallId(side, level.price);
      const wall: Wall = {
        wallId,
        side,
        initialPrice: level.price,
        currentPrice: level.price,
        initialNotional: level.notionalQuote,
        currentNotional: level.notionalQuote,
        highestNotional: level.notionalQuote,
        lowestNotional: level.notionalQuote,
        firstSeen: now,
        lastSeen: now,
        ageMs: 0,
        priceMovementPercent: 0,
        notionalChangePercent: 0,
        status: WallStatus.NEW,
      };

      this.walls.set(wallId, wall);
      index.walls.push(wall);
      index.byCurrentPrice.set(level.price, wall);
      this.matchedWalls.add(wall);
    }

    if (currentPriceIndexChanged) {
      this.rebuildCurrentPriceIndex(index);
    }
  }

  private findNearbyWall(
    price: number,
    candidates: readonly Wall[],
  ): Wall | undefined {
    let closestWall: Wall | undefined;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const wall of candidates) {
      if (this.matchedWalls.has(wall)) {
        continue;
      }

      const distancePercent = Math.abs(
        ((price - wall.currentPrice) / wall.currentPrice) * 100,
      );

      if (
        distancePercent <= this.config.priceTolerancePercent &&
        distancePercent < closestDistance
      ) {
        closestWall = wall;
        closestDistance = distancePercent;
      }
    }

    return closestWall;
  }

  private updateWall(wall: Wall, level: OrderLevel, now: number): void {
    wall.currentPrice = level.price;
    wall.currentNotional = level.notionalQuote;
    wall.lastSeen = now;
    wall.ageMs = now - wall.firstSeen;
    wall.highestNotional = Math.max(wall.highestNotional, level.notionalQuote);
    wall.lowestNotional = Math.min(wall.lowestNotional, level.notionalQuote);
    wall.priceMovementPercent = Math.abs(
      ((wall.currentPrice - wall.initialPrice) / wall.initialPrice) * 100,
    );
    wall.notionalChangePercent =
      ((wall.currentNotional - wall.initialNotional) / wall.initialNotional) *
      100;

    if (wall.ageMs >= this.config.strongAfterMs) {
      wall.status = WallStatus.STRONG;
    } else if (wall.ageMs >= this.config.persistentAfterMs) {
      wall.status = WallStatus.PERSISTENT;
    } else {
      wall.status = WallStatus.ACTIVE;
    }
  }

  private rebuildCurrentPriceIndex(index: SideWallIndex): void {
    index.byCurrentPrice.clear();

    for (const wall of index.walls) {
      index.byCurrentPrice.set(wall.currentPrice, wall);
    }
  }

  private removeMissingWalls(now: number): void {
    let buyIndexChanged = false;
    let sellIndexChanged = false;

    for (const [key, wall] of this.walls) {
      if (this.matchedWalls.has(wall)) {
        continue;
      }

      if (now - wall.lastSeen >= this.config.removalGracePeriodMs) {
        this.walls.delete(key);

        if (wall.side === WallSide.BUY) {
          buyIndexChanged = true;
        } else {
          sellIndexChanged = true;
        }
      }
    }

    if (buyIndexChanged) {
      this.compactSideIndex(this.sideIndexes[WallSide.BUY]);
    }

    if (sellIndexChanged) {
      this.compactSideIndex(this.sideIndexes[WallSide.SELL]);
    }
  }

  private compactSideIndex(index: SideWallIndex): void {
    let retainedCount = 0;

    for (const wall of index.walls) {
      if (this.walls.get(wall.wallId) !== wall) {
        continue;
      }

      index.walls[retainedCount] = wall;
      retainedCount += 1;
    }

    index.walls.length = retainedCount;
    this.rebuildCurrentPriceIndex(index);
  }

  public reset(): void {
    this.walls.clear();
    this.matchedWalls.clear();

    for (const side of [WallSide.BUY, WallSide.SELL]) {
      const index = this.sideIndexes[side];

      index.walls.length = 0;
      index.byCurrentPrice.clear();
    }
  }

  private createWallId(side: WallSide, price: number): string {
    const baseId = `${side}:${price}`;

    if (!this.walls.has(baseId)) {
      return baseId;
    }

    let suffix = 2;
    while (this.walls.has(`${baseId}#${suffix}`)) {
      suffix += 1;
    }

    return `${baseId}#${suffix}`;
  }
}
