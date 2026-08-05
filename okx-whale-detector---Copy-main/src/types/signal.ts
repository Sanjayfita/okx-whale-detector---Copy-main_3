export enum SignalType {
  BUY_SUPPORT = 'BUY_SUPPORT',
  SELL_RESISTANCE = 'SELL_RESISTANCE',
  BUY_PRESSURE = 'BUY_PRESSURE',
  SELL_PRESSURE = 'SELL_PRESSURE',
  STRONG_BUY_SUPPORT = 'STRONG_BUY_SUPPORT',
  STRONG_SELL_RESISTANCE = 'STRONG_SELL_RESISTANCE',
  NEUTRAL = 'NEUTRAL',
}

export interface Signal {
  signal: SignalType;
  confidence: number;
  reasons: string[];
  timestamp: number;
}

export type MarketBias = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export interface MarketSignal {
  bias: MarketBias;
  confidence: number;
  reason: string;
  bidPressure: number;
  askPressure: number;
  netPressure: number;
  timestamp: number;
}
