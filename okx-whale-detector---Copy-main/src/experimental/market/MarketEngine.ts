import { OrderBookManager } from '../../core/OrderBookManager';
import { WhaleTracker } from '../../core/WhaleTracker';
import { MarketAnalyzer } from '../../core/MarketAnalyzer';
import type { OrderBookLevel } from '../../types/orderbook';

import type { Whale } from '../../types/whale';

export interface MarketSnapshot {
  symbol: string;

  bestBid?: number;
  bestAsk?: number;

  activeWhales: Whale[];

  bidWhales: Whale[];
  askWhales: Whale[];

  bidPressure: number;
  askPressure: number;

  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;
  reason: string;
}

export class MarketEngine {
  public readonly symbol: string;

  private readonly orderBookManager: OrderBookManager;

  private readonly whaleTracker: WhaleTracker;

  private readonly marketAnalyzer: MarketAnalyzer;

  private latestSnapshot: MarketSnapshot | null = null;

  public constructor(symbol: string) {
    this.symbol = symbol;

    this.orderBookManager = new OrderBookManager();

    this.whaleTracker = new WhaleTracker();

    this.marketAnalyzer = new MarketAnalyzer();
  }

  public processOrderBook(
    bids: OrderBookLevel[],
    asks: OrderBookLevel[],
    timestamp: number,
    seqId: number,
    prevSeqId: number,
    action: 'snapshot' | 'update',
  ): MarketSnapshot {
    const wasApplied = this.orderBookManager.applyUpdate(
      bids,
      asks,
      timestamp,
      seqId,
      prevSeqId,
      action,
    );

    if (!wasApplied) {
      throw new Error(`Order-book sequence gap for ${this.symbol}`);
    }

    const result = this.whaleTracker.scan(this.orderBookManager.getOrderBook());

    const bestBid = this.orderBookManager.getBestBid();

    const bestAsk = this.orderBookManager.getBestAsk();

    const marketSignal = this.marketAnalyzer.analyze(
      result.active,
      bestBid?.price ?? 0,
    );

    const bidWhales = result.active.filter((whale) => whale.side === 'BID');

    const askWhales = result.active.filter((whale) => whale.side === 'ASK');

    const snapshot: MarketSnapshot = {
      symbol: this.symbol,

      bestBid: bestBid?.price,
      bestAsk: bestAsk?.price,

      activeWhales: result.active,

      bidWhales,
      askWhales,

      bidPressure: marketSignal.bidPressure,

      askPressure: marketSignal.askPressure,

      bias: marketSignal.bias,

      confidence: marketSignal.confidence,

      reason: marketSignal.reason,
    };

    this.latestSnapshot = snapshot;

    return snapshot;
  }

  public getSnapshot(): MarketSnapshot | null {
    return this.latestSnapshot;
  }
}
