export interface MarketState {
  instId: string;
  bestBid: number;
  bestAsk: number;
  midPrice: number;
  spread: number;
  spreadPercent: number;
  totalBidNotional: number;
  totalAskNotional: number;
  imbalanceRatio: number;
  timestamp: number;
}
