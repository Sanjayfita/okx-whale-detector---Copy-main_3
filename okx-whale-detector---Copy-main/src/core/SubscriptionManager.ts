import {
  OKXWebSocketClient,
  type OKXOrderBookUpdate,
  type OKXTradeUpdate,
} from '../clients/okx/OKXWebSocketClient';
import {
  OKXCandleWebSocketClient,
  type OKXCandle,
} from '../clients/okx/OKXCandleWebSocketClient';
import type {
  MarketInstrumentConfig,
  SupportedInstType,
} from '../types/instrument';
import {
  OrderBookResyncCoordinator,
  type OrderBookResyncCoordinatorOptions,
  type OrderBookResyncSnapshot,
} from './OrderBookResyncCoordinator';
import type { PipelineProfiler } from './PipelineProfiler';
import type { MessagePerformanceContext } from './PerformanceTrace';

interface OrderBookClient {
  onReconnect(callback: () => void): void;
  onOrderBook(
    callback: (
      update: OKXOrderBookUpdate,
      performanceContext?: MessagePerformanceContext,
    ) => void,
  ): void;
  onTrade?(
    callback: (
      update: OKXTradeUpdate,
      performanceContext?: MessagePerformanceContext,
    ) => void,
  ): void;
  subscribeToOrderBook(instId: string, instType: SupportedInstType): void;
  subscribeToTrades?(instId: string, instType: SupportedInstType): void;
  resubscribeOrderBook?(instId: string): void;
  close(): void;
}

interface CandleClient {
  onCandle(
    callback: (
      candle: OKXCandle,
      performanceContext?: MessagePerformanceContext,
    ) => void,
  ): void;
  subscribeToCandle(instId: string): void;
  close(): void;
}

export interface SubscriptionShard {
  readonly index: number;
  readonly symbols: readonly string[];
}

export interface SubscriptionManagerOptions {
  maximumSymbolsPerConnection: number;
  profiler?: PipelineProfiler;
  createOrderBookClient?: () => OrderBookClient;
  createCandleClient?: () => CandleClient;
  onOrderBook: (
    update: OKXOrderBookUpdate,
    performanceContext?: MessagePerformanceContext,
  ) => void;
  onTrade?: (
    update: OKXTradeUpdate,
    performanceContext?: MessagePerformanceContext,
  ) => void;
  onCandle: (
    candle: OKXCandle,
    performanceContext?: MessagePerformanceContext,
  ) => void;
  onShardReconnect: (symbols: readonly string[]) => void;
  orderBookResync?: OrderBookResyncCoordinatorOptions;
}

interface ActiveShard extends SubscriptionShard {
  readonly orderBookClient: OrderBookClient;
  readonly candleClient: CandleClient;
}

interface SymbolSubscription {
  readonly instrument: MarketInstrumentConfig;
  readonly client: OrderBookClient;
}

const chunk = <T>(values: readonly T[], size: number): T[][] => {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
};

export class SubscriptionManager {
  private readonly activeShards: ActiveShard[] = [];
  private readonly symbolSubscriptions = new Map<string, SymbolSubscription>();
  private readonly resyncCoordinator: OrderBookResyncCoordinator;
  private started = false;

  public constructor(private readonly options: SubscriptionManagerOptions) {
    if (
      !Number.isInteger(options.maximumSymbolsPerConnection) ||
      options.maximumSymbolsPerConnection <= 0
    ) {
      throw new Error('maximumSymbolsPerConnection must be a positive integer');
    }

    this.resyncCoordinator = new OrderBookResyncCoordinator(
      (symbol) => this.resubscribeOrderBook(symbol),
      options.orderBookResync,
    );
  }

  public start(instruments: readonly MarketInstrumentConfig[]): void {
    if (this.started) {
      throw new Error('SubscriptionManager has already been started');
    }

    const seenSymbols = new Set<string>();

    for (const instrument of instruments) {
      if (seenSymbols.has(instrument.instId)) {
        throw new Error(
          `Duplicate subscription instrument: ${instrument.instId}`,
        );
      }

      seenSymbols.add(instrument.instId);
    }

    this.started = true;

    const instrumentGroups = chunk(
      instruments,
      this.options.maximumSymbolsPerConnection,
    );

    for (const [index, group] of instrumentGroups.entries()) {
      const orderBookClient =
        this.options.createOrderBookClient?.() ??
        new OKXWebSocketClient(this.options.profiler);
      const candleClient =
        this.options.createCandleClient?.() ??
        new OKXCandleWebSocketClient(this.options.profiler);
      const symbols = group.map((instrument) => instrument.instId);

      orderBookClient.onOrderBook((update, performanceContext) => {
        if (update.action === 'snapshot') {
          this.resyncCoordinator.complete(update.instId);
        }

        if (performanceContext === undefined) {
          this.options.onOrderBook(update);
        } else {
          this.options.onOrderBook(update, performanceContext);
        }
      });
      candleClient.onCandle(this.options.onCandle);
      if (this.options.onTrade && orderBookClient.onTrade) {
        orderBookClient.onTrade(this.options.onTrade);
      }
      orderBookClient.onReconnect(() => {
        this.options.onShardReconnect(symbols);
      });

      for (const instrument of group) {
        orderBookClient.subscribeToOrderBook(
          instrument.instId,
          instrument.instType,
        );
        if (this.options.onTrade && orderBookClient.subscribeToTrades) {
          orderBookClient.subscribeToTrades(
            instrument.instId,
            instrument.instType,
          );
        }
        candleClient.subscribeToCandle(instrument.instId);
        this.symbolSubscriptions.set(instrument.instId, {
          instrument,
          client: orderBookClient,
        });
      }

      this.activeShards.push({
        index,
        symbols,
        orderBookClient,
        candleClient,
      });
    }
  }

  public requestOrderBookResync(symbol: string): boolean {
    if (!this.started || !this.symbolSubscriptions.has(symbol)) {
      return false;
    }

    return this.resyncCoordinator.request(symbol);
  }

  public getOrderBookResyncSnapshot(): readonly OrderBookResyncSnapshot[] {
    return this.resyncCoordinator.getSnapshot();
  }

  public getShards(): readonly SubscriptionShard[] {
    return this.activeShards.map(({ index, symbols }) => ({ index, symbols }));
  }

  public close(): void {
    this.resyncCoordinator.close();

    for (const shard of this.activeShards) {
      shard.orderBookClient.close();
      shard.candleClient.close();
    }

    this.activeShards.length = 0;
    this.symbolSubscriptions.clear();
  }

  private resubscribeOrderBook(symbol: string): void {
    const subscription = this.symbolSubscriptions.get(symbol);
    if (!subscription) {
      throw new Error(`No active subscription exists for ${symbol}`);
    }
    if (!subscription.client.resubscribeOrderBook) {
      throw new Error(
        `Order-book client does not support per-symbol resync for ${symbol}`,
      );
    }

    subscription.client.resubscribeOrderBook(symbol);
  }
}
