export enum WallStatus {
  NEW = 'NEW',
  ACTIVE = 'ACTIVE',
  PERSISTENT = 'PERSISTENT',
  STRONG = 'STRONG',
  FADING = 'FADING',
  REMOVED = 'REMOVED',
}

export enum WallSide {
  BUY = 'BUY',
  SELL = 'SELL',
}

export interface Wall {
  wallId: string;
  side: WallSide;
  initialPrice: number;
  currentPrice: number;
  initialNotional: number;
  currentNotional: number;
  highestNotional: number;
  lowestNotional: number;
  firstSeen: number;
  lastSeen: number;
  ageMs: number;
  priceMovementPercent: number;
  notionalChangePercent: number;
  status: WallStatus;
}
