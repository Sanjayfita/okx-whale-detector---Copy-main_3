import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExternalSignalCorrelationService } from '../src/external/core/ExternalSignalCorrelationService';
import { createAppRuntime, start } from '../src/index';
import { PolymarketLiveSignalRuntime } from '../src/external/providers/polymarket/PolymarketLiveSignalRuntime';
import type { PolymarketLiveTrade } from '../src/external/providers/polymarket/PolymarketMarketWebSocketClient';
import { PipelineProfiler } from '../src/core/PipelineProfiler';

class FakeWebSocketClient {
  public connected = false;
  public closed = false;
  public readonly trades: PolymarketLiveTrade[] = [];
  private readonly onTrade: (trade: PolymarketLiveTrade) => void;

  public constructor(onTrade: (trade: PolymarketLiveTrade) => void) {
    this.onTrade = onTrade;
  }

  public connect(): void {
    this.connected = true;
  }

  public close(): void {
    this.closed = true;
  }

  public emit(trade: PolymarketLiveTrade): void {
    this.trades.push(trade);
    this.onTrade(trade);
  }
}

vi.mock('../src/clients/okx/OKXInstrumentClient', () => ({
  OKXInstrumentClient: class {
    public async loadMarketInstruments(): Promise<Map<string, unknown>> {
      return new Map([
        [
          'BTC-USDT',
          {
            instId: 'BTC-USDT',
            instType: 'SPOT',
            quoteCurrency: 'USDT',
            baseUnitsPerSize: 1,
          },
        ],
      ]);
    }
  },
}));

vi.mock('../src/clients/okx/OKXMarketDiscoveryClient', () => ({
  OKXMarketDiscoveryClient: class {
    public async discoverProfiles(): Promise<Array<{ symbol: string }>> {
      return [{ symbol: 'BTC-USDT' }];
    }
  },
}));

vi.mock('../src/core/SubscriptionManager', () => ({
  SubscriptionManager: class {
    public start(): void {}
    public getShards(): Array<{ index: number; symbols: readonly string[] }> {
      return [];
    }
    public close(): void {}
  },
}));

vi.mock('../src/core/MarketHealthMonitor', () => ({
  MarketHealthMonitor: class {
    public constructor() {}
    public start(): void {}
    public stop(): void {}
    public recordOrderBook(): void {}
    public recordCandle(): void {}
    public resetSymbols(): void {}
  },
}));

vi.mock('../src/core/ThroughputMonitor', () => ({
  ThroughputMonitor: class {
    public constructor() {}
    public start(): void {}
    public stop(): void {}
    public record(): void {}
    public resetSymbols(): void {}
  },
}));

vi.mock('../src/core/CandleUpdateHandler', () => ({
  CandleUpdateHandler: class {
    public constructor() {}
    public handle(): void {}
    public resetSymbols(): void {}
  },
}));

describe('PolymarketLiveSignalRuntime', () => {
  let logger: {
    log: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    logger = {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  });

  it('adds qualifying aggregations into the injected correlation service', async () => {
    const correlationService = new ExternalSignalCorrelationService();
    const profiler = new PipelineProfiler();
    const publicClient = {
      getActiveMarkets: vi.fn().mockResolvedValue([
        {
          id: 'market-1',
          conditionId: 'condition-1',
          question: 'Will BTC reach $100k by 2026?',
          slug: 'btc-100k',
          liquidity: 100_000,
          volume: 50_000,
          tokenIds: ['token-1'],
          outcomes: ['Yes', 'No'],
          endDate: '2030-01-01T00:00:00.000Z',
          category: 'Crypto',
        },
      ]),
    };

    const webSocketClientFactory = vi.fn(
      (
        tokenIds: readonly string[],
        onTrade: (trade: PolymarketLiveTrade) => void,
      ) => new FakeWebSocketClient(onTrade),
    );
    const runtime = new PolymarketLiveSignalRuntime(
      {
        minimumSignalUsd: 5_000,
        minimumLiquidityUsd: 5_000,
        marketLimit: 5,
        watchMarkets: 5,
        windowSeconds: 60,
        minimumDominance: 0.15,
        signalCooldownSeconds: 60,
        statusSeconds: 60,
        showExecutions: false,
        enabled: true,
      },
      {
        publicClient: publicClient as never,
        webSocketClientFactory: webSocketClientFactory as never,
        correlationService,
        profiler,
        logger,
        now: () => 1_700_000,
      },
    );

    await runtime.start();

    const [client] = webSocketClientFactory.mock.results.map(
      (result) => result.value,
    ) as FakeWebSocketClient[];
    client.emit({
      conditionId: 'condition-1',
      tokenId: 'token-1',
      price: 100_000,
      size: 60,
      side: 'BUY',
      timestamp: 1_700_000,
      transactionHash: 'tx-1',
    });

    expect(correlationService.getSize(1_700_000)).toBe(1);
    expect(
      correlationService.getFreshRelevantSignals('BTC-USDT', 1_700_000),
    ).toHaveLength(1);
    expect(profiler.getRecentStage('polymarket.interpretation')?.count).toBe(1);
    expect(profiler.getRecentStage('polymarket.aggregation')?.count).toBe(1);
    expect(
      profiler.getRecentStage('polymarket.signalConstructionStore')?.count,
    ).toBe(1);
  });

  it('does not add non-qualifying aggregations into the correlation service', async () => {
    const correlationService = new ExternalSignalCorrelationService();
    const publicClient = {
      getActiveMarkets: vi.fn().mockResolvedValue([
        {
          id: 'market-1',
          conditionId: 'condition-1',
          question: 'Will BTC reach $100k by 2026?',
          slug: 'btc-100k',
          liquidity: 100_000,
          volume: 50_000,
          tokenIds: ['token-1'],
          outcomes: ['Yes', 'No'],
          endDate: '2030-01-01T00:00:00.000Z',
          category: 'Crypto',
        },
      ]),
    };
    const webSocketClientFactory = vi.fn(
      (
        tokenIds: readonly string[],
        onTrade: (trade: PolymarketLiveTrade) => void,
      ) => new FakeWebSocketClient(onTrade),
    );
    const runtime = new PolymarketLiveSignalRuntime(
      {
        minimumSignalUsd: 5_000,
        minimumLiquidityUsd: 5_000,
        marketLimit: 5,
        watchMarkets: 5,
        windowSeconds: 60,
        minimumDominance: 0.15,
        signalCooldownSeconds: 60,
        statusSeconds: 60,
        showExecutions: false,
        enabled: true,
      },
      {
        publicClient: publicClient as never,
        webSocketClientFactory: webSocketClientFactory as never,
        correlationService,
        logger,
        now: () => 1_700_000,
      },
    );

    await runtime.start();

    const [client] = webSocketClientFactory.mock.results.map(
      (result) => result.value,
    ) as FakeWebSocketClient[];
    client.emit({
      conditionId: 'condition-1',
      tokenId: 'token-1',
      price: 1,
      size: 1,
      side: 'BUY',
      timestamp: 1_700_000,
      transactionHash: 'tx-2',
    });

    expect(correlationService.getSize(1_700_000)).toBe(0);
  });

  it('merges duplicate rolling updates through the signal store', async () => {
    const correlationService = new ExternalSignalCorrelationService();
    const publicClient = {
      getActiveMarkets: vi.fn().mockResolvedValue([
        {
          id: 'market-1',
          conditionId: 'condition-1',
          question: 'Will BTC reach $100k by 2026?',
          slug: 'btc-100k',
          liquidity: 100_000,
          volume: 50_000,
          tokenIds: ['token-1'],
          outcomes: ['Yes', 'No'],
          endDate: '2030-01-01T00:00:00.000Z',
          category: 'Crypto',
        },
      ]),
    };
    const webSocketClientFactory = vi.fn(
      (
        tokenIds: readonly string[],
        onTrade: (trade: PolymarketLiveTrade) => void,
      ) => new FakeWebSocketClient(onTrade),
    );
    const runtime = new PolymarketLiveSignalRuntime(
      {
        minimumSignalUsd: 5_000,
        minimumLiquidityUsd: 5_000,
        marketLimit: 5,
        watchMarkets: 5,
        windowSeconds: 60,
        minimumDominance: 0.15,
        signalCooldownSeconds: 60,
        statusSeconds: 60,
        showExecutions: false,
        enabled: true,
      },
      {
        publicClient: publicClient as never,
        webSocketClientFactory: webSocketClientFactory as never,
        correlationService,
        logger,
        now: () => 1_700_000,
      },
    );

    await runtime.start();

    const [client] = webSocketClientFactory.mock.results.map(
      (result) => result.value,
    ) as FakeWebSocketClient[];
    client.emit({
      conditionId: 'condition-1',
      tokenId: 'token-1',
      price: 100_000,
      size: 60,
      side: 'BUY',
      timestamp: 1_700_000,
      transactionHash: 'tx-3',
    });
    client.emit({
      conditionId: 'condition-1',
      tokenId: 'token-1',
      price: 100_000,
      size: 60,
      side: 'BUY',
      timestamp: 1_700_000,
      transactionHash: 'tx-4',
    });

    expect(correlationService.getSize(1_700_000)).toBe(1);
  });

  it('stops pending discovery before creating a WebSocket client', async () => {
    const correlationService = new ExternalSignalCorrelationService();
    let resolveMarkets: ((value: Array<unknown>) => void) | undefined;
    const pendingMarkets = new Promise<Array<unknown>>((resolve) => {
      resolveMarkets = resolve;
    });
    const publicClient = {
      getActiveMarkets: vi.fn().mockReturnValue(pendingMarkets),
    };
    const webSocketClientFactory = vi.fn(
      (
        tokenIds: readonly string[],
        onTrade: (trade: PolymarketLiveTrade) => void,
      ) => new FakeWebSocketClient(onTrade),
    );
    const timerApi = {
      setInterval: vi.fn(() => ({ cleared: false }) as never),
      clearInterval: vi.fn(),
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    };
    const runtime = new PolymarketLiveSignalRuntime(
      {
        enabled: true,
        minimumSignalUsd: 5_000,
        minimumLiquidityUsd: 5_000,
        marketLimit: 5,
        watchMarkets: 5,
        windowSeconds: 60,
        minimumDominance: 0.15,
        signalCooldownSeconds: 60,
        statusSeconds: 60,
        showExecutions: false,
      },
      {
        publicClient: publicClient as never,
        webSocketClientFactory: webSocketClientFactory as never,
        correlationService,
        logger,
        now: () => 1_700_000,
        timerApi: timerApi as never,
      },
    );

    const startPromise = runtime.start();
    runtime.stop();
    resolveMarkets?.([
      {
        id: 'market-1',
        conditionId: 'condition-1',
        question: 'Will BTC reach $100k by 2026?',
        slug: 'btc-100k',
        liquidity: 100_000,
        volume: 50_000,
        tokenIds: ['token-1'],
        outcomes: ['Yes', 'No'],
        endDate: '2030-01-01T00:00:00.000Z',
        category: 'Crypto',
      },
    ]);

    await expect(startPromise).resolves.toBeUndefined();
    expect(webSocketClientFactory).not.toHaveBeenCalled();
    expect(timerApi.setInterval).not.toHaveBeenCalled();
    expect(logger.log).not.toHaveBeenCalledWith(
      'Polymarket live ingestion ready.',
    );
  });

  it('does not throw when Polymarket startup fails and logs a warning', async () => {
    const runtime = new PolymarketLiveSignalRuntime(
      {
        enabled: true,
      },
      {
        publicClient: {
          getActiveMarkets: vi.fn().mockRejectedValue(new Error('boom')),
        } as never,
        correlationService: new ExternalSignalCorrelationService(),
        logger,
        now: () => 1_700_000,
      },
    );

    await expect(runtime.start()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('does not create timers when shutdown occurs during pending discovery', async () => {
    const correlationService = new ExternalSignalCorrelationService();
    let resolveMarkets: ((value: Array<unknown>) => void) | undefined;
    const pendingMarkets = new Promise<Array<unknown>>((resolve) => {
      resolveMarkets = resolve;
    });
    const timerApi = {
      setInterval: vi.fn(() => ({ cleared: false }) as never),
      clearInterval: vi.fn(),
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    };
    const runtime = new PolymarketLiveSignalRuntime(
      {
        enabled: true,
        minimumSignalUsd: 5_000,
        minimumLiquidityUsd: 5_000,
        marketLimit: 5,
        watchMarkets: 5,
        windowSeconds: 60,
        minimumDominance: 0.15,
        signalCooldownSeconds: 60,
        statusSeconds: 60,
        showExecutions: false,
      },
      {
        publicClient: {
          getActiveMarkets: vi.fn().mockReturnValue(pendingMarkets),
        } as never,
        correlationService,
        logger,
        now: () => 1_700_000,
        timerApi: timerApi as never,
      },
    );

    const startPromise = runtime.start();
    runtime.stop();
    resolveMarkets?.([]);

    await expect(startPromise).resolves.toBeUndefined();
    expect(timerApi.setInterval).not.toHaveBeenCalled();
  });

  it('starts only one client and timer for duplicate start calls', async () => {
    const correlationService = new ExternalSignalCorrelationService();
    const publicClient = {
      getActiveMarkets: vi.fn().mockResolvedValue([
        {
          id: 'market-1',
          conditionId: 'condition-1',
          question: 'Will BTC reach $100k by 2026?',
          slug: 'btc-100k',
          liquidity: 100_000,
          volume: 50_000,
          tokenIds: ['token-1'],
          outcomes: ['Yes', 'No'],
          endDate: '2030-01-01T00:00:00.000Z',
          category: 'Crypto',
        },
      ]),
    };
    const webSocketClientFactory = vi.fn(
      (
        tokenIds: readonly string[],
        onTrade: (trade: PolymarketLiveTrade) => void,
      ) => new FakeWebSocketClient(onTrade),
    );
    const timerApi = {
      setInterval: vi.fn(() => ({ cleared: false }) as never),
      clearInterval: vi.fn(),
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    };
    const runtime = new PolymarketLiveSignalRuntime(
      {
        enabled: true,
        minimumSignalUsd: 5_000,
        minimumLiquidityUsd: 5_000,
        marketLimit: 5,
        watchMarkets: 5,
        windowSeconds: 60,
        minimumDominance: 0.15,
        signalCooldownSeconds: 60,
        statusSeconds: 60,
        showExecutions: false,
      },
      {
        publicClient: publicClient as never,
        webSocketClientFactory: webSocketClientFactory as never,
        correlationService,
        logger,
        now: () => 1_700_000,
        timerApi: timerApi as never,
      },
    );

    await Promise.all([runtime.start(), runtime.start()]);

    expect(webSocketClientFactory).toHaveBeenCalledTimes(1);
    expect(timerApi.setInterval).toHaveBeenCalledTimes(1);
  });

  it('does not throw for duplicate stop calls', () => {
    const runtime = new PolymarketLiveSignalRuntime(
      { enabled: true },
      {
        publicClient: {
          getActiveMarkets: vi.fn().mockResolvedValue([]),
        } as never,
        correlationService: new ExternalSignalCorrelationService(),
        logger,
        now: () => 1_700_000,
      },
    );

    expect(() => {
      runtime.stop();
      runtime.stop();
    }).not.toThrow();
  });

  it('resolves startup without blocking the app bootstrap', async () => {
    const pendingRuntime = {
      start: vi
        .fn()
        .mockImplementation(() => new Promise<void>(() => undefined)),
    };

    await expect(
      start({ polymarketRuntime: pendingRuntime as never }),
    ).resolves.toBeUndefined();
  });

  it('uses the same service instance for ingestion and MarketEngine', async () => {
    const runtime = await createAppRuntime();

    const marketEngineCorrelationService = (
      runtime.marketEngine as unknown as {
        correlationService?: ExternalSignalCorrelationService;
      }
    ).correlationService;

    expect(marketEngineCorrelationService).toBe(
      runtime.externalSignalCorrelationService,
    );
    expect(
      (
        runtime.polymarketRuntime as unknown as {
          correlationService?: ExternalSignalCorrelationService;
        }
      ).correlationService,
    ).toBe(runtime.externalSignalCorrelationService);
  });

  it('stops the runtime by closing the WebSocket client and clearing timers', async () => {
    const correlationService = new ExternalSignalCorrelationService();
    const publicClient = {
      getActiveMarkets: vi.fn().mockResolvedValue([
        {
          id: 'market-1',
          conditionId: 'condition-1',
          question: 'Will BTC reach $100k by 2026?',
          slug: 'btc-100k',
          liquidity: 100_000,
          volume: 50_000,
          tokenIds: ['token-1'],
          outcomes: ['Yes', 'No'],
          endDate: '2030-01-01T00:00:00.000Z',
          category: 'Crypto',
        },
      ]),
    };
    const webSocketClientFactory = vi.fn(
      (
        tokenIds: readonly string[],
        onTrade: (trade: PolymarketLiveTrade) => void,
      ) => new FakeWebSocketClient(onTrade),
    );
    const timerEntries: Array<{ cleared: boolean }> = [];
    const timerApi = {
      setInterval: vi.fn(() => {
        const entry = { cleared: false };
        timerEntries.push(entry);
        return entry as never;
      }),
      clearInterval: vi.fn((value: unknown) => {
        const entry = value as { cleared: boolean };
        entry.cleared = true;
      }),
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    };
    const runtime = new PolymarketLiveSignalRuntime(
      {
        minimumSignalUsd: 5_000,
        minimumLiquidityUsd: 5_000,
        marketLimit: 5,
        watchMarkets: 5,
        windowSeconds: 60,
        minimumDominance: 0.15,
        signalCooldownSeconds: 60,
        statusSeconds: 60,
        showExecutions: false,
        enabled: true,
      },
      {
        publicClient: publicClient as never,
        webSocketClientFactory: webSocketClientFactory as never,
        correlationService,
        logger,
        now: () => 1_700_000,
        timerApi: timerApi as never,
      },
    );

    await runtime.start();
    runtime.stop();

    const [client] = webSocketClientFactory.mock.results.map(
      (result) => result.value,
    ) as FakeWebSocketClient[];
    expect(client.closed).toBe(true);
    expect(timerEntries.every((entry) => entry.cleared)).toBe(true);
  });
});
