export type CandleInterval =
  '1m' | '5m' | '15m' | '30m' | '1H' | '4H' | '1D' | '1W';

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  confirmed: boolean;
}
