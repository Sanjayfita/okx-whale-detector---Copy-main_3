export type WhaleSide = 'BID' | 'ASK';

export interface Whale {
  wallId: string;
  side: WhaleSide;
  price: number;
  size: number;
  notionalQuote: number;
  quoteCurrency: 'USDT';
  detectedAt: number;

  firstSeenAt?: number;

  lastSeenAt?: number;

  ageSeconds?: number;

  updateCount?: number;

  maxNotionalQuote?: number;

  strength?: number;
}

export interface WhaleThresholds {
  minNotionalQuote: number;
}

export type WhaleChangeType =
  'NEW' | 'INCREASED' | 'REDUCED' | 'REFILLED' | 'MOVED' | 'REMOVED';

export interface WhaleChange {
  wallId: string;
  type: WhaleChangeType;
  side: WhaleSide;
  price: number;
  previousPrice?: number;
  previousSize: number;
  currentSize: number;
  sizeDifference: number;
  previousNotionalQuote: number;
  currentNotionalQuote: number;
  timestamp: number;
}
