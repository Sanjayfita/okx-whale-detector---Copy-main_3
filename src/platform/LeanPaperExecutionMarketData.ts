import { OKXInstrumentClient } from '../clients/okx/OKXInstrumentClient';
import {
  OKXWebSocketClient,
  type OKXOrderBookUpdate,
} from '../clients/okx/OKXWebSocketClient';
import {
  resolveSymbolConfig,
  SYMBOL_PROFILES,
  type SymbolProfile,
} from '../config/symbolProfiles';
import { OrderBookManager } from '../core/OrderBookManager';
import type { MarketInstrumentConfig } from '../types/instrument';
import type { ExecutionMarketState } from './TradingPlatformEngine';

export interface LeanExecutionInstrumentLoader {
  loadMarketInstruments(
    profiles: readonly SymbolProfile[],
  ): Promise<Map<string, MarketInstrumentConfig>>;
}

export interface LeanExecutionOrderBookClient {
  onOrderBook(callback: (update: OKXOrderBookUpdate) => void): void;
  onReconnect(callback: () => void): void;
  subscribeToOrderBook(instId: string, instType: 'SWAP' | 'FUTURES'): void;
  resubscribeOrderBook(instId: string): void;
  close(): void;
}

export interface LeanPaperExecutionMarketDataOptions {
  readonly profiles?: readonly SymbolProfile[];
  readonly instrumentLoader?: LeanExecutionInstrumentLoader;
  readonly orderBookClient?: LeanExecutionOrderBookClient;
  readonly onOrderBook: (
    instrumentId: string,
    state: ExecutionMarketState,
  ) => void;
}

export interface LeanPaperExecutionMarketDataRuntime {
  readonly instruments: number;
  close(): void;
}

/**
 * Minimal execution-data runtime for local EMA paper trading.
 *
 * It intentionally owns only derivative instrument metadata plus bounded
 * OrderBookManager instances. Whale tracking, research recorders, market
 * discovery, Polymarket and other research services remain in createAppRuntime()
 * and are started only when the caller explicitly enables research mode.
 */
export const startLeanPaperExecutionMarketData = async (
  options: LeanPaperExecutionMarketDataOptions,
): Promise<LeanPaperExecutionMarketDataRuntime> => {
  const profiles = options.profiles ?? SYMBOL_PROFILES;
  const instrumentLoader = options.instrumentLoader ?? new OKXInstrumentClient();
  const instruments = await instrumentLoader.loadMarketInstruments(profiles);
  const states = new Map<string, ExecutionMarketState>();

  for (const profile of profiles) {
    const instrument = instruments.get(profile.symbol);
    if (instrument === undefined) {
      throw new Error(`Missing execution metadata for ${profile.symbol}`);
    }
    states.set(profile.symbol, {
      instrument,
      orderBookManager: new OrderBookManager(
        instrument,
        resolveSymbolConfig(profile.symbol).history.orderBookLevelLimit,
      ),
    });
  }

  const client = options.orderBookClient ?? new OKXWebSocketClient();
  const resyncing = new Set<string>();

  const requestFreshSnapshot = (instrumentId: string): void => {
    if (resyncing.has(instrumentId)) return;
    const state = states.get(instrumentId);
    if (state === undefined) return;
    resyncing.add(instrumentId);
    state.orderBookManager.markResyncing();
    try {
      client.resubscribeOrderBook(instrumentId);
    } catch (error: unknown) {
      resyncing.delete(instrumentId);
      console.error(
        `Lean paper order-book resync failed for ${instrumentId}:`,
        error,
      );
    }
  };

  client.onOrderBook((update) => {
    const state = states.get(update.instId);
    if (state === undefined) return;
    const applied = state.orderBookManager.applyUpdate(
      update.bids,
      update.asks,
      update.timestamp,
      update.seqId,
      update.prevSeqId,
      update.action,
    );
    if (!applied) {
      requestFreshSnapshot(update.instId);
      return;
    }
    if (update.action === 'snapshot') resyncing.delete(update.instId);
    options.onOrderBook(update.instId, state);
  });

  client.onReconnect(() => {
    resyncing.clear();
    for (const state of states.values()) state.orderBookManager.markResyncing();
  });

  for (const profile of profiles) {
    client.subscribeToOrderBook(profile.symbol, profile.instrumentType);
  }

  return {
    instruments: states.size,
    close: () => client.close(),
  };
};
