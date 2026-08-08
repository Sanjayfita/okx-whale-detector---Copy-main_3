import type {
  OKXCandle,
  OKXCandleConnectionStatus,
} from '../clients/okx/OKXCandleWebSocketClient';
import type { TradingTimeframe } from '../config/tradingTimeframes';
import type { MarketState } from '../core/MarketState';

export interface CandleTimeframeController {
  setTimeframe(timeframe: TradingTimeframe): void;
  getTimeframe(): TradingTimeframe;
  getConnectionStatus?(): OKXCandleConnectionStatus;
  reconnect?(): void;
}

/**
 * Optional observer boundary between the existing OKX runtime and the platform.
 * The timeframe preparation hook lets the platform rebuild native OKX history
 * before live candle subscriptions begin, without moving exchange connectivity
 * into the dashboard layer.
 */
export interface TradingPlatformObserver {
  onOrderBook(instrumentId: string, state: MarketState): void;
  onCandle(candle: OKXCandle): void;
  prepareCandleRuntime?(input: {
    readonly symbols: readonly string[];
    readonly controller: CandleTimeframeController;
  }): Promise<void> | void;
  resetSymbols?(symbols: readonly string[]): void;
  close?(): Promise<void> | void;
}
