import type { MarketInstrumentConfig } from '../types/instrument';
import type { OrderBook, OrderBookLevel, OrderLevel } from '../types/orderbook';

const DEFAULT_INSTRUMENT: MarketInstrumentConfig = {
  instId: 'UNKNOWN-USDT',
  instType: 'SPOT',
  quoteCurrency: 'USDT',
  baseUnitsPerSize: 1,
};

export class OrderBookManager {
  private readonly orderBook: OrderBook = {
    bids: new Map(),
    asks: new Map(),
    lastSeqId: null,
    status: 'INITIALIZING',
    initialized: false,
    updatedAt: 0,
  };
  private lastUpdatePrunedDepth = false;

  public constructor(
    private readonly instrument: MarketInstrumentConfig = DEFAULT_INSTRUMENT,
    private readonly maximumLevelsPerSide: number = 400,
  ) {
    if (
      !Number.isFinite(instrument.baseUnitsPerSize) ||
      instrument.baseUnitsPerSize <= 0
    ) {
      throw new Error('instrument.baseUnitsPerSize must be greater than 0');
    }

    if (!Number.isInteger(maximumLevelsPerSide) || maximumLevelsPerSide <= 0) {
      throw new Error('maximumLevelsPerSide must be a positive integer');
    }
  }

  public applyUpdate(
    bids: OrderBookLevel[],
    asks: OrderBookLevel[],
    timestamp: number,
    seqId: number,
    prevSeqId: number,
    action: 'snapshot' | 'update',
  ): boolean {
    this.lastUpdatePrunedDepth = false;

    if (
      !Number.isSafeInteger(timestamp) ||
      timestamp < 0 ||
      !Number.isSafeInteger(seqId) ||
      !Number.isSafeInteger(prevSeqId)
    ) {
      this.markInvalid();
      return false;
    }

    if (action === 'snapshot') {
      this.orderBook.bids.clear();
      this.orderBook.asks.clear();

      this.applyLevels(this.orderBook.bids, bids, timestamp);
      this.applyLevels(this.orderBook.asks, asks, timestamp);
      this.lastUpdatePrunedDepth = this.pruneDepth();

      this.orderBook.lastSeqId = seqId;
      this.orderBook.updatedAt = timestamp;
      this.orderBook.initialized = true;
      this.orderBook.status = 'SYNCED';

      return true;
    }

    if (
      !this.orderBook.initialized ||
      this.orderBook.lastSeqId === null ||
      prevSeqId !== this.orderBook.lastSeqId ||
      timestamp < this.orderBook.updatedAt
    ) {
      this.markInvalid();

      return false;
    }

    this.applyLevels(this.orderBook.bids, bids, timestamp);
    this.applyLevels(this.orderBook.asks, asks, timestamp);
    this.lastUpdatePrunedDepth = this.pruneDepth();

    this.orderBook.lastSeqId = seqId;
    this.orderBook.updatedAt = timestamp;
    this.orderBook.status = 'SYNCED';

    return true;
  }

  public markResyncing(): void {
    this.orderBook.bids.clear();
    this.orderBook.asks.clear();
    this.orderBook.lastSeqId = null;
    this.orderBook.status = 'RESYNCING';
    this.orderBook.initialized = false;
    this.orderBook.updatedAt = 0;
    this.lastUpdatePrunedDepth = false;
  }

  public reset(): void {
    this.orderBook.bids.clear();
    this.orderBook.asks.clear();
    this.orderBook.lastSeqId = null;
    this.orderBook.status = 'INITIALIZING';
    this.orderBook.initialized = false;
    this.orderBook.updatedAt = 0;
    this.lastUpdatePrunedDepth = false;
  }

  private applyLevels(
    side: Map<number, OrderLevel>,
    levels: OrderBookLevel[],
    timestamp: number,
  ): void {
    for (const level of levels) {
      const rawPrice = level[0];
      const rawSize = level[1];

      if (rawPrice === undefined || rawSize === undefined) {
        continue;
      }

      const price = Number(rawPrice);
      const size = Number(rawSize);

      if (
        !Number.isFinite(price) ||
        price <= 0 ||
        !Number.isFinite(size) ||
        size < 0
      ) {
        continue;
      }

      if (size === 0) {
        side.delete(price);
        continue;
      }

      const notionalQuote = price * size * this.instrument.baseUnitsPerSize;

      if (!Number.isFinite(notionalQuote) || notionalQuote <= 0) {
        continue;
      }

      side.set(price, {
        price,
        rawPrice,
        size,
        rawSize,
        notionalQuote,
        quoteCurrency: this.instrument.quoteCurrency,
        updatedAt: timestamp,
      });
    }
  }

  private pruneDepth(): boolean {
    const bidsPruned = this.pruneSide(this.orderBook.bids, true);
    const asksPruned = this.pruneSide(this.orderBook.asks, false);

    return bidsPruned || asksPruned;
  }

  private pruneSide(
    side: Map<number, OrderLevel>,
    keepHighest: boolean,
  ): boolean {
    if (side.size <= this.maximumLevelsPerSide) {
      return false;
    }

    const retainedPrices = [...side.keys()]
      .sort((left, right) => (keepHighest ? right - left : left - right))
      .slice(0, this.maximumLevelsPerSide);
    const retained = new Set(retainedPrices);

    for (const price of side.keys()) {
      if (!retained.has(price)) {
        side.delete(price);
      }
    }

    return true;
  }

  public didLastUpdatePruneDepth(): boolean {
    return this.lastUpdatePrunedDepth;
  }

  public getOrderBook(): OrderBook {
    return this.orderBook;
  }

  public getBestBid(): OrderLevel | undefined {
    let best: OrderLevel | undefined;

    for (const level of this.orderBook.bids.values()) {
      if (!best || level.price > best.price) {
        best = level;
      }
    }

    return best;
  }

  public getBestAsk(): OrderLevel | undefined {
    let best: OrderLevel | undefined;

    for (const level of this.orderBook.asks.values()) {
      if (!best || level.price < best.price) {
        best = level;
      }
    }

    return best;
  }

  public getMidPrice(): number | undefined {
    const bestBid = this.getBestBid();
    const bestAsk = this.getBestAsk();

    if (!bestBid || !bestAsk) {
      return undefined;
    }

    return (bestBid.price + bestAsk.price) / 2;
  }

  public isUsableForSignals(): boolean {
    if (!this.orderBook.initialized || this.orderBook.status !== 'SYNCED') {
      return false;
    }

    const bestBid = this.getBestBid();
    const bestAsk = this.getBestAsk();

    return (
      bestBid !== undefined &&
      bestAsk !== undefined &&
      bestBid.price < bestAsk.price
    );
  }

  private markInvalid(): void {
    this.orderBook.status = 'INVALID';
    this.orderBook.initialized = false;
  }
}
