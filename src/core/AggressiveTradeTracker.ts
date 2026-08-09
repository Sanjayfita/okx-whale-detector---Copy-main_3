export type AggressiveTradeSide = 'BUY' | 'SELL';

export interface AggressiveTrade {
  side: AggressiveTradeSide;
  price: number;
  size: number;
  notionalQuote: number;
  timestamp: number;
}

export interface TradeFlowSnapshot {
  buyVolume: number;
  sellVolume: number;
  buyNotionalQuote: number;
  sellNotionalQuote: number;
  tradeCount: number;
}

export class AggressiveTradeTracker {
  private buyVolume = 0;
  private sellVolume = 0;

  private buyNotionalQuote = 0;
  private sellNotionalQuote = 0;

  private tradeCount = 0;

  public recordTrade(trade: AggressiveTrade): void {
    this.tradeCount++;

    if (trade.side === 'BUY') {
      this.buyVolume += trade.size;
      this.buyNotionalQuote += trade.notionalQuote;
    } else {
      this.sellVolume += trade.size;
      this.sellNotionalQuote += trade.notionalQuote;
    }
  }

  public getSnapshot(): TradeFlowSnapshot {
    return {
      buyVolume: this.buyVolume,
      sellVolume: this.sellVolume,
      buyNotionalQuote: this.buyNotionalQuote,
      sellNotionalQuote: this.sellNotionalQuote,
      tradeCount: this.tradeCount,
    };
  }

  public reset(): void {
    this.buyVolume = 0;
    this.sellVolume = 0;
    this.buyNotionalQuote = 0;
    this.sellNotionalQuote = 0;
    this.tradeCount = 0;
  }
}
