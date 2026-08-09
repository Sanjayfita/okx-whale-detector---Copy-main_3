import type {
  OKXCandle,
  OKXCandleConnectionStatus,
} from '../clients/okx/OKXCandleWebSocketClient';
import type { TradingTimeframe } from '../config/tradingTimeframes';
import type { ExecutionMarketState } from './TradingPlatformEngine';

export interface CandleTimeframeController {
  setTimeframe(timeframe: TradingTimeframe): void;
  getTimeframe(): TradingTimeframe;
  getConnectionStatus?(): OKXCandleConnectionStatus;
  reconnect?(): void;
}

/**
 * Optional observer boundary between OKX market-data runtimes and the platform.
 * The execution-market state deliberately exposes only instrument metadata and
 * an order-book manager, so lean paper trading does not need to instantiate the
 * whale/research MarketState graph.
 */
export interface TradingPlatformObserver {
  onOrderBook(instrumentId: string, state: ExecutionMarketState): void;
  onCandle(candle: OKXCandle): void;
  prepareCandleRuntime?(input: {
    readonly symbols: readonly string[];
    readonly controller: CandleTimeframeController;
  }): Promise<void> | void;
  resetSymbols?(symbols: readonly string[]): void;
  close?(): Promise<void> | void;
}
