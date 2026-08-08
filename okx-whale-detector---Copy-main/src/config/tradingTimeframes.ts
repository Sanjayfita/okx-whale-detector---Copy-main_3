export const TRADING_TIMEFRAMES = [
  '1m',
  '3m',
  '5m',
  '15m',
  '30m',
  '1H',
  '2H',
  '4H',
] as const;

export type TradingTimeframe = (typeof TRADING_TIMEFRAMES)[number];

export interface TradingTimeframeSpec {
  readonly value: TradingTimeframe;
  readonly label: string;
  readonly okxBar: string;
  readonly websocketChannel: string;
  readonly intervalMs: number;
}

const specs: Readonly<Record<TradingTimeframe, TradingTimeframeSpec>> = {
  '1m': { value: '1m', label: '1m', okxBar: '1m', websocketChannel: 'candle1m', intervalMs: 60_000 },
  '3m': { value: '3m', label: '3m', okxBar: '3m', websocketChannel: 'candle3m', intervalMs: 3 * 60_000 },
  '5m': { value: '5m', label: '5m', okxBar: '5m', websocketChannel: 'candle5m', intervalMs: 5 * 60_000 },
  '15m': { value: '15m', label: '15m', okxBar: '15m', websocketChannel: 'candle15m', intervalMs: 15 * 60_000 },
  '30m': { value: '30m', label: '30m', okxBar: '30m', websocketChannel: 'candle30m', intervalMs: 30 * 60_000 },
  '1H': { value: '1H', label: '1H', okxBar: '1H', websocketChannel: 'candle1H', intervalMs: 60 * 60_000 },
  '2H': { value: '2H', label: '2H', okxBar: '2H', websocketChannel: 'candle2H', intervalMs: 2 * 60 * 60_000 },
  '4H': { value: '4H', label: '4H', okxBar: '4H', websocketChannel: 'candle4H', intervalMs: 4 * 60 * 60_000 },
};

export const isTradingTimeframe = (value: unknown): value is TradingTimeframe =>
  typeof value === 'string' && (TRADING_TIMEFRAMES as readonly string[]).includes(value);

export const requireTradingTimeframe = (value: unknown): TradingTimeframe => {
  if (!isTradingTimeframe(value)) {
    throw new Error(`Unsupported trading timeframe: ${String(value)}`);
  }
  return value;
};

export const tradingTimeframeSpec = (
  timeframe: TradingTimeframe,
): TradingTimeframeSpec => specs[timeframe];

export const tradingTimeframeFromWebSocketChannel = (
  channel: string,
): TradingTimeframe | null =>
  TRADING_TIMEFRAMES.find(
    (timeframe) => specs[timeframe].websocketChannel === channel,
  ) ?? null;
