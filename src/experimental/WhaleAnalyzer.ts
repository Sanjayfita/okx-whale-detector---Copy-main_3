import type { OrderBook } from '../types/orderbook';
import type { Whale } from '../types/whale';

export interface WhaleAnalysis {
  whale: Whale;
  distancePercent: number;
  distanceUSD: number;
  strength: 'LOW' | 'MEDIUM' | 'HIGH';
}

export class WhaleAnalyzer {
  public analyze(orderBook: OrderBook, whales: Whale[]): WhaleAnalysis[] {
    const bestBid = this.getBestBid(orderBook);
    const bestAsk = this.getBestAsk(orderBook);

    if (!bestBid || !bestAsk) {
      return [];
    }

    const midPrice = (bestBid.price + bestAsk.price) / 2;

    return whales
      .map((whale) => {
        const distanceUSD = whale.price - midPrice;

        const distancePercent = (distanceUSD / midPrice) * 100;

        let strength: WhaleAnalysis['strength'];

        if (whale.notionalQuote >= 1_000_000) {
          strength = 'HIGH';
        } else if (whale.notionalQuote >= 750_000) {
          strength = 'MEDIUM';
        } else {
          strength = 'LOW';
        }

        return {
          whale,
          distancePercent,
          distanceUSD,
          strength,
        };
      })
      .sort(
        (a, b) => Math.abs(a.distancePercent) - Math.abs(b.distancePercent),
      );
  }

  private getBestBid(orderBook: OrderBook) {
    return [...orderBook.bids.values()].sort((a, b) => b.price - a.price)[0];
  }

  private getBestAsk(orderBook: OrderBook) {
    return [...orderBook.asks.values()].sort((a, b) => a.price - b.price)[0];
  }
}
