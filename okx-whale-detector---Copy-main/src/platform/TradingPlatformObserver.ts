import type { OKXCandle } from '../clients/okx/OKXCandleWebSocketClient';
import type { MarketState } from '../core/MarketState';

/**
 * Optional observer boundary between the existing OKX runtime and the platform.
 * Keeping this interface tiny avoids coupling market connectivity to dashboard,
 * paper-account, notification, or HTTP-server implementations.
 */
export interface TradingPlatformObserver {
  onOrderBook(instrumentId: string, state: MarketState): void;
  onCandle(candle: OKXCandle): void;
  close?(): Promise<void> | void;
}
