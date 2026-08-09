export type OrderBookLevel = [
  price: string,
  size: string,
  liquidatedOrders: string,
  orderCount: string,
];

export type QuoteCurrency = 'USDT';

export interface OrderLevel {
  price: number;
  rawPrice: string;
  size: number;
  rawSize: string;

  /*
   * For SPOT:
   * price × base-asset size,
   * denominated in quoteCurrency.
   */
  notionalQuote: number;

  quoteCurrency: QuoteCurrency;

  updatedAt: number;
}

export type OrderBookStatus =
  'INITIALIZING' | 'SYNCED' | 'INVALID' | 'RESYNCING';

export interface OrderBook {
  bids: Map<number, OrderLevel>;
  asks: Map<number, OrderLevel>;
  lastSeqId: number | null;
  status: OrderBookStatus;
  initialized: boolean;
  updatedAt: number;
}
