import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MarketEngine,
  prepareMarketSummaryAggregates,
} from '../src/market/MarketEngine';

import { MarketState } from '../src/core/MarketState';

import { SummaryThrottle } from '../src/core/SummaryThrottle';

import { CorrelatedAlertEngine } from '../src/alerts/CorrelatedAlertEngine';
import { ExternalSignalCorrelationService } from '../src/external/core/ExternalSignalCorrelationService';
import { CorrelatedAlertReporter } from '../src/reporting/CorrelatedAlertReporter';
import { MarketReporter } from '../src/reporting/MarketReporter';
import { CorrelatedAlertRecorder } from '../src/recording/CorrelatedAlertRecorder';
import type { PerformanceTrace } from '../src/core/PerformanceTrace';
import { appConfig } from '../src/config/appConfig';

import type { OKXOrderBookUpdate } from '../src/clients/okx/OKXWebSocketClient';
import type { MarketEvaluation } from '../src/types/marketEvaluation';
import { WallSide, WallStatus, type Wall } from '../src/types/wall';
import type { Whale } from '../src/types/whale';

const createWhale = (
  side: Whale['side'],
  wallId: string,
  notionalQuote: number,
): Whale => ({
  wallId,
  side,
  price: 100,
  size: 10_000,
  notionalQuote,
  quoteCurrency: 'USDT',
  detectedAt: 1_000,
});

const createWall = (status: WallStatus, wallId: string): Wall => ({
  wallId,
  side: WallSide.BUY,
  initialPrice: 100,
  currentPrice: 100,
  initialNotional: 1_000_000,
  currentNotional: 1_000_000,
  highestNotional: 1_000_000,
  lowestNotional: 1_000_000,
  firstSeen: 1_000,
  lastSeen: 1_000,
  ageMs: 0,
  priceMovementPercent: 0,
  notionalChangePercent: 0,
  status,
});

const prepareLegacyEquivalent = (
  active: readonly Whale[],
  walls: readonly Wall[] = [],
) =>
  prepareMarketSummaryAggregates(
    {
      active: [...active],
      totalBidNotionalQuote: active
        .filter((whale) => whale.side === 'BID')
        .reduce((total, whale) => total + whale.notionalQuote, 0),
      totalAskNotionalQuote: active
        .filter((whale) => whale.side === 'ASK')
        .reduce((total, whale) => total + whale.notionalQuote, 0),
    },
    walls,
  );

const createSnapshot = (
  overrides: Partial<OKXOrderBookUpdate> = {},
): OKXOrderBookUpdate => ({
  instId: 'BTC-USDT',

  action: 'snapshot',

  bids: [['100', '2', '0', '1']],

  asks: [['101', '3', '0', '1']],

  timestamp: 1_000,

  seqId: 10,

  prevSeqId: -1,

  ...overrides,
});

const createUpdate = (
  overrides: Partial<OKXOrderBookUpdate> = {},
): OKXOrderBookUpdate => ({
  instId: 'BTC-USDT',

  action: 'update',

  bids: [['100', '3', '0', '1']],

  asks: [],

  timestamp: 2_000,

  seqId: 11,

  prevSeqId: 10,

  ...overrides,
});

const createCorrelatedEvaluation = (): MarketEvaluation => ({
  marketSignal: {
    bias: 'BULLISH',
    confidence: 75,
    reason: 'Strong OKX pressure',
    bidPressure: 80,
    askPressure: 20,
    netPressure: 60,
    timestamp: Date.now(),
  },
  correlatedSignal: {
    symbol: 'BTC-USDT',
    bias: 'BULLISH',
    confidence: 70,
    alertImportance: 70,
    okxBias: 'BULLISH',
    okxConfidence: 75,
    externalBias: 'BULLISH',
    externalConfidence: 60,
    agreement: 'AGREEMENT',
    bullishExternalScore: 60,
    bearishExternalScore: 0,
    neutralExternalSignals: 0,
    consideredSignals: 1,
    ignoredSignals: 0,
    contributions: [],
    reason: 'OKX and external intelligence agree.',
    timestamp: Date.now(),
  },
});

describe('prepareMarketSummaryAggregates', () => {
  it.each([
    {
      name: 'zero whales',
      whales: [],
      expected: {
        bidWhaleCount: 0,
        askWhaleCount: 0,
        totalBidWhaleNotionalQuote: 0,
        totalAskWhaleNotionalQuote: 0,
      },
    },
    {
      name: 'BID-only whales',
      whales: [createWhale('BID', 'bid-1', 1_000_000)],
      expected: {
        bidWhaleCount: 1,
        askWhaleCount: 0,
        totalBidWhaleNotionalQuote: 1_000_000,
        totalAskWhaleNotionalQuote: 0,
      },
    },
    {
      name: 'ASK-only whales',
      whales: [createWhale('ASK', 'ask-1', 2_000_000)],
      expected: {
        bidWhaleCount: 0,
        askWhaleCount: 1,
        totalBidWhaleNotionalQuote: 0,
        totalAskWhaleNotionalQuote: 2_000_000,
      },
    },
    {
      name: 'mixed whales',
      whales: [
        createWhale('BID', 'bid-1', 1_000_000),
        createWhale('ASK', 'ask-1', 2_000_000),
        createWhale('BID', 'bid-2', 3_000_000),
      ],
      expected: {
        bidWhaleCount: 2,
        askWhaleCount: 1,
        totalBidWhaleNotionalQuote: 4_000_000,
        totalAskWhaleNotionalQuote: 2_000_000,
      },
    },
  ])('matches legacy calculations for $name', ({ whales, expected }) => {
    expect(prepareLegacyEquivalent(whales)).toMatchObject({
      ...expected,
      totalActiveWhaleCount: whales.length,
    });
  });

  it('counts every reported wall category while retaining all tracked walls', () => {
    const walls = [
      createWall(WallStatus.NEW, 'new'),
      createWall(WallStatus.ACTIVE, 'active'),
      createWall(WallStatus.PERSISTENT, 'persistent'),
      createWall(WallStatus.STRONG, 'strong'),
      createWall(WallStatus.FADING, 'fading'),
      createWall(WallStatus.REMOVED, 'removed'),
    ];

    expect(prepareLegacyEquivalent([], walls)).toMatchObject({
      trackedWallCount: 6,
      newWallCount: 1,
      activeWallCount: 1,
      persistentWallCount: 1,
      strongWallCount: 1,
    });
  });

  it('keeps symbols isolated and does not mutate detector collections', () => {
    const btcWhales = [createWhale('BID', 'btc-bid', 1_000_000)];
    const ethWhales = [createWhale('ASK', 'eth-ask', 2_000_000)];
    const btcWalls = [createWall(WallStatus.NEW, 'btc-wall')];
    const ethWalls = [createWall(WallStatus.STRONG, 'eth-wall')];
    const originalBtcWhales = structuredClone(btcWhales);
    const originalEthWhales = structuredClone(ethWhales);
    const originalBtcWalls = structuredClone(btcWalls);
    const originalEthWalls = structuredClone(ethWalls);

    const btc = prepareLegacyEquivalent(btcWhales, btcWalls);
    const eth = prepareLegacyEquivalent(ethWhales, ethWalls);

    expect(btc).toMatchObject({
      bidWhaleCount: 1,
      askWhaleCount: 0,
      newWallCount: 1,
      strongWallCount: 0,
    });
    expect(eth).toMatchObject({
      bidWhaleCount: 0,
      askWhaleCount: 1,
      newWallCount: 0,
      strongWallCount: 1,
    });
    expect(btcWhales).toEqual(originalBtcWhales);
    expect(ethWhales).toEqual(originalEthWhales);
    expect(btcWalls).toEqual(originalBtcWalls);
    expect(ethWalls).toEqual(originalEthWalls);
  });
});

describe('MarketEngine', () => {
  let marketStates: Map<string, MarketState>;

  let state: MarketState;

  let engine: MarketEngine;

  beforeEach(() => {
    vi.useFakeTimers();

    vi.setSystemTime(new Date('2026-07-26T00:00:00Z'));

    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    state = new MarketState(appConfig, {
      instId: 'BTC-USDT',
      instType: 'SPOT',
      quoteCurrency: 'USDT',
      baseUnitsPerSize: 1,
    });

    marketStates = new Map([['BTC-USDT', state]]);

    engine = new MarketEngine(marketStates, new SummaryThrottle(5_000));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('logs PERSISTENT only once across repeated updates', () => {
    const whale = {
      side: 'ASK' as const,
      wallId: 'wall-1',
      price: 101,

      size: 10_000,

      notionalQuote: 1_010_000,

      quoteCurrency: 'USDT' as const,

      detectedAt: Date.now(),

      firstSeenAt: Date.now() - 30_000,

      lastSeenAt: Date.now(),

      ageSeconds: 30,

      updateCount: 5,

      maxNotionalQuote: 1_010_000,

      strength: 1,
    };

    /*
     * Keep the exact same whale identity
     * across both order-book updates.
     */
    vi.spyOn(state.whaleTracker, 'scan').mockReturnValue({
      active: [whale],

      trackedWalls: 1,

      newWalls: 0,

      persistentWalls: 1,

      strongWalls: 0,

      totalBidNotionalQuote: 0,

      totalAskNotionalQuote: whale.notionalQuote,

      strongestBid: undefined,

      strongestAsk: whale,

      newWhales: [],

      removedWhales: [],

      movedWhales: [],
    });

    vi.spyOn(state.whaleBehaviorEngine, 'analyze').mockImplementation(
      (analyzedWhale) => [
        {
          type: 'PERSISTENT',

          whale: analyzedWhale,

          confidence: 80,

          reason: 'Whale has remained active for 30s',

          detectedAt: Date.now(),
        },
      ],
    );

    engine.processOrderBookUpdate(createSnapshot());

    engine.processOrderBookUpdate(createUpdate());

    const persistentLogs = vi
      .mocked(console.log)
      .mock.calls.filter((call) =>
        String(call[0]).startsWith('🧠 PERSISTENT |'),
      );

    expect(persistentLogs).toHaveLength(1);
  });

  it('ignores updates for an unknown symbol', () => {
    expect(() => {
      engine.processOrderBookUpdate(
        createSnapshot({
          instId: 'UNKNOWN-USDT',
        }),
      );
    }).not.toThrow();

    expect(state.orderBookManager.getOrderBook().initialized).toBe(false);
  });

  it('applies a valid snapshot to the correct market state', () => {
    engine.processOrderBookUpdate(createSnapshot());

    const orderBook = state.orderBookManager.getOrderBook();

    expect(orderBook.initialized).toBe(true);

    expect(orderBook.status).toBe('SYNCED');

    expect(orderBook.lastSeqId).toBe(10);

    expect(state.orderBookManager.getBestBid()?.price).toBe(100);

    expect(state.orderBookManager.getBestAsk()?.price).toBe(101);
  });

  it('applies a sequence-continuous update after a snapshot', () => {
    engine.processOrderBookUpdate(createSnapshot());

    engine.processOrderBookUpdate(createUpdate());

    const orderBook = state.orderBookManager.getOrderBook();

    expect(orderBook.status).toBe('SYNCED');

    expect(orderBook.lastSeqId).toBe(11);

    expect(state.orderBookManager.getBestBid()?.size).toBe(3);
  });

  it('rejects a sequence gap and logs it only once', () => {
    engine.processOrderBookUpdate(createSnapshot());

    engine.processOrderBookUpdate(
      createUpdate({
        seqId: 12,

        prevSeqId: 999,
      }),
    );

    engine.processOrderBookUpdate(
      createUpdate({
        seqId: 13,

        prevSeqId: 999,
      }),
    );

    expect(console.error).toHaveBeenCalledTimes(1);

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Order-book sequence gap for BTC-USDT'),
    );

    expect(state.orderBookManager.getOrderBook().status).not.toBe('SYNCED');
  });

  it('accepts a fresh snapshot after a sequence gap', () => {
    engine.processOrderBookUpdate(createSnapshot());

    engine.processOrderBookUpdate(
      createUpdate({
        seqId: 12,

        prevSeqId: 999,
      }),
    );

    engine.processOrderBookUpdate(
      createSnapshot({
        timestamp: 3_000,

        seqId: 20,

        bids: [['200', '4', '0', '1']],

        asks: [['201', '5', '0', '1']],
      }),
    );

    const orderBook = state.orderBookManager.getOrderBook();

    expect(orderBook.status).toBe('SYNCED');

    expect(orderBook.lastSeqId).toBe(20);

    expect(state.orderBookManager.getBestBid()?.price).toBe(200);

    expect(state.orderBookManager.getBestAsk()?.price).toBe(201);
  });

  it('clears internal gap and throttle state when reset', () => {
    engine.processOrderBookUpdate(createSnapshot());

    engine.processOrderBookUpdate(
      createUpdate({
        seqId: 12,

        prevSeqId: 999,
      }),
    );

    expect(console.error).toHaveBeenCalledTimes(1);

    engine.reset();

    /*
     * Replace the invalid market
     * state just as index.ts does
     * after reconnect.
     */
    const replacementState = new MarketState();

    marketStates.set('BTC-USDT', replacementState);

    engine.processOrderBookUpdate(
      createSnapshot({
        seqId: 30,
      }),
    );

    expect(replacementState.orderBookManager.getOrderBook().status).toBe(
      'SYNCED',
    );
  });

  it('correlates once and passes the same evaluation to reporting and alerts', () => {
    const evaluation = createCorrelatedEvaluation();
    const correlationService = new ExternalSignalCorrelationService();
    const correlateSpy = vi
      .spyOn(correlationService, 'correlateMarketSignal')
      .mockReturnValue(evaluation);
    const alertEngine = new CorrelatedAlertEngine({
      clock: () => Date.now(),
      sourceSessionId: 'market-engine-test',
    });
    const evaluateSpy = vi.spyOn(alertEngine, 'evaluate');
    const alertReporter = new CorrelatedAlertReporter();
    const alertReportSpy = vi.spyOn(alertReporter, 'report');
    const alertRecorder = new CorrelatedAlertRecorder({
      outputPath: 'data/alerts/test-market-engine.jsonl',
      writerFactory: () => ({
        append: vi.fn(),
        close: vi.fn(),
      }),
    });
    const alertRecordSpy = vi.spyOn(alertRecorder, 'record');
    const marketReporter = new MarketReporter();
    const summarySpy = vi.spyOn(marketReporter, 'reportSummary');
    const integratedEngine = new MarketEngine(
      marketStates,
      new SummaryThrottle(5_000),
      marketReporter,
      undefined,
      undefined,
      correlationService,
      alertEngine,
      alertReporter,
      alertRecorder,
    );

    integratedEngine.processOrderBookUpdate(createSnapshot());

    expect(correlateSpy).toHaveBeenCalledTimes(1);
    expect(evaluateSpy).toHaveBeenCalledTimes(1);
    expect(evaluateSpy).toHaveBeenCalledWith(evaluation, Date.now());
    expect(summarySpy).toHaveBeenCalledWith(
      expect.objectContaining({ evaluation }),
      expect.anything(),
    );
    expect(alertReportSpy).toHaveBeenCalledTimes(1);
    expect(alertReportSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'BTC-USDT',
        relationship: 'AGREEMENT',
        createdAt: Date.now(),
      }),
      expect.anything(),
    );
    expect(alertRecordSpy).toHaveBeenCalledTimes(1);
    expect(alertRecordSpy.mock.calls[0]?.[0]).toBe(
      alertReportSpy.mock.calls[0]?.[0],
    );
    expect(alertRecordSpy.mock.calls[0]?.[1]).toEqual({
      provenance: 'LIVE',
      evaluationContext: {
        instId: 'BTC-USDT',
        instType: 'SPOT',
        okxBias: 'BULLISH',
        externalBias: 'BULLISH',
        sourceSignalTimestamp: Date.now(),
        sourceMarketTimestamp: 1_000,
        referenceTimestamp: 1_000,
        referenceMidpoint: 100.5,
        referenceBestBid: 100,
        referenceBestAsk: 101,
        referenceSpread: 1,
        referenceSpreadPercent: (1 / 100.5) * 100,
        sourceSignalIds: [],
      },
    });
    const trace = summarySpy.mock.calls[0]?.[1] as PerformanceTrace;
    expect(trace.getSnapshot()).toMatchObject({
      summaryProcessed: true,
      alertEmitted: true,
      alertPersisted: true,
      recorderFsync: true,
    });
  });

  it('captures an event-time alpha context only after a whale alert is persisted', () => {
    const evaluation = createCorrelatedEvaluation();
    const correlationService = new ExternalSignalCorrelationService();
    vi.spyOn(correlationService, 'correlateMarketSignal').mockReturnValue(
      evaluation,
    );
    const whale: Whale = {
      wallId: 'alpha-bid-wall',
      side: 'BID',
      price: 100,
      size: 10_000,
      notionalQuote: 1_000_000,
      quoteCurrency: 'USDT',
      detectedAt: Date.now() - 30_000,
      firstSeenAt: Date.now() - 30_000,
      lastSeenAt: Date.now(),
      ageSeconds: 30,
      updateCount: 4,
      maxNotionalQuote: 1_000_000,
      strength: 70,
    };
    vi.spyOn(state.whaleTracker, 'scan').mockReturnValue({
      active: [whale],
      trackedWalls: 1,
      newWalls: 0,
      persistentWalls: 1,
      strongWalls: 0,
      totalBidNotionalQuote: whale.notionalQuote,
      totalAskNotionalQuote: 0,
      strongestBid: whale,
      strongestAsk: undefined,
      newWhales: [],
      removedWhales: [],
      movedWhales: [],
    });
    state.candleHistory.add({
      instId: 'BTC-USDT',
      timestamp: Date.now() - 120_000,
      open: 99,
      high: 101,
      low: 98,
      close: 100,
      volume: 10,
      volumeCurrency: 10,
      volumeCurrencyQuote: 1_000,
      confirm: true,
    });
    state.tradeFlowTracker.record({
      instId: 'BTC-USDT',
      tradeId: 'alpha-flow',
      price: 100,
      size: 2,
      side: 'SELL',
      timestamp: Date.now() - 100,
    });
    const alertRecorder = new CorrelatedAlertRecorder({
      outputPath: 'data/alerts/test-alpha-context.jsonl',
      writerFactory: () => ({ append: vi.fn(), close: vi.fn() }),
    });
    const observer = vi.fn();
    const integratedEngine = new MarketEngine(
      marketStates,
      new SummaryThrottle(5_000),
      undefined,
      undefined,
      undefined,
      correlationService,
      new CorrelatedAlertEngine({ sourceSessionId: 'market-engine-alpha' }),
      undefined,
      alertRecorder,
      Date.now,
      'LIVE',
      undefined,
      {},
      observer,
    );

    integratedEngine.processOrderBookUpdate(createSnapshot());

    expect(observer).toHaveBeenCalledOnce();
    expect(observer.mock.calls[0]?.[0]).toMatchObject({
      alert: { symbol: 'BTC-USDT', bias: 'BULLISH' },
      marketContext: {
        instrumentId: 'BTC-USDT',
        candles: [
          expect.objectContaining({
            intervalStart: Date.now() - 120_000,
            availabilityTimestamp: Date.now(),
          }),
        ],
        orderBook: {
          eventTimestamp: 1_000,
          availabilityTimestamp: Date.now(),
          bids: [{ price: 100, size: 2 }],
          asks: [{ price: 101, size: 3 }],
        },
        trades: [
          expect.objectContaining({
            tradeId: 'alpha-flow',
            side: 'SELL',
          }),
        ],
        whale: {
          wallPersistenceMs: 30_000,
          refillCount: 0,
          spoofProbability: null,
          absorptionScore: null,
          whaleNotionalQuote: 1_000_000,
        },
      },
    });
  });

  it('does not derive or persist signals from an invalid crossed book', () => {
    const evaluation = createCorrelatedEvaluation();
    const correlationService = new ExternalSignalCorrelationService();
    const correlateSpy = vi
      .spyOn(correlationService, 'correlateMarketSignal')
      .mockReturnValue(evaluation);
    const scanSpy = vi.spyOn(state.whaleTracker, 'scan');
    const alertRecorder = new CorrelatedAlertRecorder({
      outputPath: 'data/alerts/test-invalid-context.jsonl',
      writerFactory: () => ({
        append: vi.fn(),
        close: vi.fn(),
      }),
    });
    const alertRecordSpy = vi.spyOn(alertRecorder, 'record');
    const integratedEngine = new MarketEngine(
      marketStates,
      new SummaryThrottle(5_000),
      undefined,
      undefined,
      undefined,
      correlationService,
      new CorrelatedAlertEngine({ sourceSessionId: 'market-engine-test' }),
      undefined,
      alertRecorder,
    );

    integratedEngine.processOrderBookUpdate(
      createSnapshot({
        bids: [['102', '2', '0', '1']],
        asks: [['101', '3', '0', '1']],
      }),
    );

    expect(scanSpy).not.toHaveBeenCalled();
    expect(correlateSpy).not.toHaveBeenCalled();
    expect(alertRecordSpy).not.toHaveBeenCalled();
  });

  it('does not derive signals from a one-sided book', () => {
    const scanSpy = vi.spyOn(state.whaleTracker, 'scan');

    engine.processOrderBookUpdate(createSnapshot({ asks: [] }));

    expect(state.orderBookManager.getOrderBook().status).toBe('SYNCED');
    expect(state.orderBookManager.isUsableForSignals()).toBe(false);
    expect(scanSpy).not.toHaveBeenCalled();
  });

  it('does not derive signals from stale or implausibly future books', () => {
    const now = 20_000;
    const scanSpy = vi.spyOn(state.whaleTracker, 'scan');
    const freshnessEngine = new MarketEngine(
      marketStates,
      new SummaryThrottle(5_000),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => now,
      'LIVE',
      undefined,
      {
        maximumOrderBookAgeMs: 5_000,
        maximumFutureSkewMs: 1_000,
      },
    );

    freshnessEngine.processOrderBookUpdate(
      createSnapshot({ timestamp: 14_999 }),
    );
    freshnessEngine.processOrderBookUpdate(
      createSnapshot({ timestamp: 21_001, seqId: 20 }),
    );

    expect(scanSpy).not.toHaveBeenCalled();

    freshnessEngine.processOrderBookUpdate(
      createSnapshot({ timestamp: 20_000, seqId: 30 }),
    );

    expect(scanSpy).toHaveBeenCalledTimes(1);
  });

  it('clears derived state once when sequence continuity is lost', () => {
    engine.processOrderBookUpdate(createSnapshot());
    const trackerReset = vi.spyOn(state.whaleTracker, 'reset');
    const wallReset = vi.spyOn(state.wallDetector, 'reset');

    engine.processOrderBookUpdate(createUpdate({ seqId: 12, prevSeqId: 999 }));
    engine.processOrderBookUpdate(createUpdate({ seqId: 13, prevSeqId: 999 }));

    expect(trackerReset).toHaveBeenCalledTimes(1);
    expect(wallReset).toHaveBeenCalledTimes(1);
  });

  it('does not record when the alert engine emits no alert', () => {
    const evaluation = createCorrelatedEvaluation();
    const correlationService = new ExternalSignalCorrelationService();
    vi.spyOn(correlationService, 'correlateMarketSignal').mockReturnValue(
      evaluation,
    );
    const alertRecorder = new CorrelatedAlertRecorder({
      outputPath: 'data/alerts/test-no-alert.jsonl',
      writerFactory: () => ({
        append: vi.fn(),
        close: vi.fn(),
      }),
    });
    const alertRecordSpy = vi.spyOn(alertRecorder, 'record');
    const integratedEngine = new MarketEngine(
      marketStates,
      new SummaryThrottle(5_000),
      undefined,
      undefined,
      undefined,
      correlationService,
      new CorrelatedAlertEngine({
        enabled: false,
        sourceSessionId: 'market-engine-test',
      }),
      undefined,
      alertRecorder,
    );

    integratedEngine.processOrderBookUpdate(createSnapshot());

    expect(alertRecordSpy).not.toHaveBeenCalled();
  });

  it('continues processing when correlated alert recording fails', () => {
    const evaluation = createCorrelatedEvaluation();
    const correlationService = new ExternalSignalCorrelationService();
    vi.spyOn(correlationService, 'correlateMarketSignal').mockReturnValue(
      evaluation,
    );
    const warn = vi.fn();
    const alertRecorder = new CorrelatedAlertRecorder({
      outputPath: 'data/alerts/test-write-failure.jsonl',
      warn,
      writerFactory: () => ({
        append: () => {
          throw new Error('disk unavailable');
        },
        close: vi.fn(),
      }),
    });
    const integratedEngine = new MarketEngine(
      marketStates,
      new SummaryThrottle(5_000),
      undefined,
      undefined,
      undefined,
      correlationService,
      new CorrelatedAlertEngine({ sourceSessionId: 'market-engine-test' }),
      undefined,
      alertRecorder,
    );

    expect(() =>
      integratedEngine.processOrderBookUpdate(createSnapshot()),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
