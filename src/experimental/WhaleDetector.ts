import type { OrderBookLevel } from '../types/orderbook';

export interface WhaleOrder {
  side: 'BID' | 'ASK';
  price: number;
  size: number;
  notionalQuote: number;
}

export class WhaleDetector {
  private readonly minimumNotionalQuote: number;

  constructor(minimumNotionalQuote: number) {
    this.minimumNotionalQuote = minimumNotionalQuote;
  }

  public detect(bids: OrderBookLevel[], asks: OrderBookLevel[]): WhaleOrder[] {
    const whales: WhaleOrder[] = [];

    for (const bid of bids) {
      const price = Number(bid[0]);
      const size = Number(bid[1]);
      const notionalQuote = price * size;

      if (notionalQuote >= this.minimumNotionalQuote) {
        whales.push({
          side: 'BID',
          price,
          size,
          notionalQuote: notionalQuote,
        });
      }
    }

    for (const ask of asks) {
      const price = Number(ask[0]);
      const size = Number(ask[1]);
      const notionalQuote = price * size;

      if (notionalQuote >= this.minimumNotionalQuote) {
        whales.push({
          side: 'ASK',
          price,
          size,
          notionalQuote: notionalQuote,
        });
      }
    }

    return whales;
  }
}
