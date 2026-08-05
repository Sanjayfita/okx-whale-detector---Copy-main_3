import { describe, expect, it, vi } from 'vitest';
import type { CorrelatedAlert } from '../src/types/correlatedAlert';
import type { CorrelatedAlertRecordContext } from '../src/types/correlatedAlertEvaluation';
import type { AlphaMarketContextObserverInput } from '../src/market/MarketEngine';
import { EvidenceCollectionRuntime } from '../src/research/evidenceCollectionRuntime';
import { CorrelatedAlertEvidenceBridge } from '../src/research/correlatedAlertEvidenceBridge';

const alert: CorrelatedAlert = {
  id: 'correlated-alert:session-1:1',
  sourceSessionId: 'session-1',
  alertSequence: 1,
  symbol: 'BTC-USDT',
  severity: 'STRONG',
  eventType: 'AGREEMENT',
  bias: 'BULLISH',
  relationship: 'AGREEMENT',
  combinedConfidence: 82,
  alertImportance: 75,
  okxConfidence: 80,
  externalEffectiveConfidence: 85,
  externalSignalsUsed: 1,
  ignoredExternalSignals: 0,
  reason: 'test alert',
  createdAt: 1_000,
};

const context: CorrelatedAlertRecordContext = {
  provenance: 'LIVE',
  evaluationContext: {
    instId: 'BTC-USDT',
    instType: 'SPOT',
    okxBias: 'BULLISH',
    externalBias: 'BULLISH',
    sourceSignalTimestamp: 900,
    sourceMarketTimestamp: 1_000,
    referenceTimestamp: 1_000,
    referenceMidpoint: 60_000,
    referenceBestBid: 59_999,
    referenceBestAsk: 60_001,
    referenceSpread: 2,
    referenceSpreadPercent: (2 / 60_000) * 100,
    sourceSignalIds: ['external-1'],
  },
};

const alphaInput = (
  currentAlert: CorrelatedAlert,
): AlphaMarketContextObserverInput => ({
  alert: currentAlert,
  evaluationContext: context.evaluationContext,
  marketContext: {
    instrumentId: currentAlert.symbol,
    detectedAt: currentAlert.createdAt,
    candles: [],
    orderBook: {
      eventTimestamp: currentAlert.createdAt,
      availabilityTimestamp: currentAlert.createdAt,
      bids: [{ price: 59_999, size: 2 }],
      asks: [{ price: 60_001, size: 2 }],
    },
    trades: [],
    whale: {
      availabilityTimestamp: currentAlert.createdAt,
      wallPersistenceMs: 10_000,
      refillCount: 0,
      spoofProbability: null,
      absorptionScore: null,
      executionRatio: 0,
      whaleNotionalQuote: 1_000_000,
    },
  },
});

describe('EvidenceCollectionRuntime', () => {
  it('initializes, serializes a live alert, and processes due observations', async () => {
    const evidence = { alertId: alert.id };
    const bridge = {
      createEvidence: vi.fn(() => evidence),
    };
    const collector = {
      initialize: vi.fn(async () => undefined),
      recordQualifiedAlert: vi.fn(async () => undefined),
      processDueObservations: vi.fn(async () => 2),
    };
    const setIntervalFn = vi.fn(() => 123 as unknown as NodeJS.Timeout);
    const clearIntervalFn = vi.fn();
    const runtime = new EvidenceCollectionRuntime({
      bridge: bridge as never,
      collector: collector as never,
      clock: () => 1_001,
      setIntervalFn,
      clearIntervalFn,
    });

    await runtime.start();
    runtime.onPersistedLiveAlert(alert, context);
    const completed = await runtime.processNow();
    await runtime.stop();

    expect(collector.initialize).toHaveBeenCalledOnce();
    expect(bridge.createEvidence).toHaveBeenCalledWith({
      alert,
      evaluationContext: context.evaluationContext,
      recordedAt: 1_001,
    });
    expect(collector.recordQualifiedAlert).toHaveBeenCalledWith(evidence);
    expect(completed).toBe(2);
    expect(clearIntervalFn).toHaveBeenCalledOnce();
  });

  it('reports alerts received before startup without recording them', () => {
    const onError = vi.fn();
    const collector = {
      initialize: vi.fn(async () => undefined),
      recordQualifiedAlert: vi.fn(async () => undefined),
      processDueObservations: vi.fn(async () => 0),
    };
    const runtime = new EvidenceCollectionRuntime({
      bridge: { createEvidence: vi.fn() } as never,
      collector: collector as never,
      onError,
    });

    runtime.onPersistedLiveAlert(alert, context);

    expect(onError).toHaveBeenCalledOnce();
    expect(collector.recordQualifiedAlert).not.toHaveBeenCalled();
  });

  it('reports and rejects an explicitly requested processing failure', async () => {
    const onError = vi.fn();
    const runtime = new EvidenceCollectionRuntime({
      bridge: { createEvidence: vi.fn() } as never,
      collector: {
        initialize: vi.fn(async () => undefined),
        recordQualifiedAlert: vi.fn(async () => undefined),
        processDueObservations: vi.fn(async () => {
          throw new Error('scheduler failed');
        }),
      } as never,
      onError,
      setIntervalFn: () => 123 as unknown as NodeJS.Timeout,
      clearIntervalFn: vi.fn(),
    });
    await runtime.start();

    await expect(runtime.processNow()).rejects.toThrow('scheduler failed');
    await runtime.stop();

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'scheduler failed' }),
    );
  });

  it('records a matching alpha market context on the serialized work chain', async () => {
    const collector = {
      initialize: vi.fn(async () => undefined),
      recordQualifiedAlert: vi.fn(async () => undefined),
      processDueObservations: vi.fn(async () => 0),
    };
    const alphaSnapshotRecorder = {
      initialize: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    };
    const bridge = new CorrelatedAlertEvidenceBridge({
      evaluationId: 'alpha-runtime',
      sourceCommit: 'test',
      configurationFingerprint: 'test-config',
    });
    const createEvidence = vi.spyOn(bridge, 'createEvidence');
    const runtime = new EvidenceCollectionRuntime({
      bridge,
      collector: collector as never,
      alphaSnapshotRecorder: alphaSnapshotRecorder as never,
      clock: () => 1_001,
      setIntervalFn: () => 123 as unknown as NodeJS.Timeout,
      clearIntervalFn: vi.fn(),
    });
    await runtime.start();
    runtime.onPersistedLiveAlert(alert, context);
    runtime.onPersistedAlphaMarketContext({
      alert,
      evaluationContext: context.evaluationContext,
      marketContext: {
        instrumentId: 'BTC-USDT',
        detectedAt: 1_000,
        candles: [],
        orderBook: {
          eventTimestamp: 1_000,
          availabilityTimestamp: 1_000,
          bids: [{ price: 59_999, size: 2 }],
          asks: [{ price: 60_001, size: 2 }],
        },
        trades: [],
        whale: {
          availabilityTimestamp: 1_000,
          wallPersistenceMs: 10_000,
          refillCount: 0,
          spoofProbability: null,
          absorptionScore: null,
          executionRatio: 0,
          whaleNotionalQuote: 1_000_000,
        },
      },
    });
    await runtime.processNow();
    await runtime.stop();

    expect(alphaSnapshotRecorder.initialize).toHaveBeenCalledOnce();
    expect(alphaSnapshotRecorder.record).toHaveBeenCalledOnce();
    const recordedSnapshot = alphaSnapshotRecorder.record.mock.calls[0]?.[0];
    expect(recordedSnapshot).toMatchObject({
      schemaVersion: 1,
      evidence: { evaluationId: 'alpha-runtime', alertId: alert.id },
      synthetic: false,
      liveOrderExecutionAllowed: false,
    });
    expect(recordedSnapshot?.evidence).toStrictEqual(
      collector.recordQualifiedAlert.mock.calls[0]?.[0],
    );
    expect(createEvidence).toHaveBeenCalledOnce();
  });

  it('rejects an alpha context that has no matching persisted alert evidence', async () => {
    const onError = vi.fn();
    const alphaSnapshotRecorder = {
      initialize: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    };
    const runtime = new EvidenceCollectionRuntime({
      bridge: new CorrelatedAlertEvidenceBridge({
        evaluationId: 'alpha-runtime',
        sourceCommit: 'test',
        configurationFingerprint: 'test-config',
      }),
      collector: {
        initialize: vi.fn(async () => undefined),
        recordQualifiedAlert: vi.fn(async () => undefined),
        processDueObservations: vi.fn(async () => 0),
      } as never,
      alphaSnapshotRecorder: alphaSnapshotRecorder as never,
      onError,
      setIntervalFn: () => 123 as unknown as NodeJS.Timeout,
      clearIntervalFn: vi.fn(),
    });
    await runtime.start();

    runtime.onPersistedAlphaMarketContext({
      alert,
      evaluationContext: context.evaluationContext,
      marketContext: {
        instrumentId: 'BTC-USDT',
        detectedAt: 1_000,
        candles: [],
        orderBook: {
          eventTimestamp: 1_000,
          availabilityTimestamp: 1_000,
          bids: [{ price: 59_999, size: 2 }],
          asks: [{ price: 60_001, size: 2 }],
        },
        trades: [],
        whale: {
          availabilityTimestamp: 1_000,
          wallPersistenceMs: null,
          refillCount: null,
          spoofProbability: null,
          absorptionScore: null,
          executionRatio: null,
          whaleNotionalQuote: null,
        },
      },
    });
    await runtime.stop();

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('no matching persisted evidence'),
      }),
    );
    expect(alphaSnapshotRecorder.record).not.toHaveBeenCalled();
  });

  it('pairs interleaved alpha contexts by alert ID without overwriting state', async () => {
    const secondAlert: CorrelatedAlert = {
      ...alert,
      id: 'correlated-alert:session-1:2',
      alertSequence: 2,
    };
    const collector = {
      initialize: vi.fn(async () => undefined),
      recordQualifiedAlert: vi.fn(async () => undefined),
      processDueObservations: vi.fn(async () => 0),
    };
    const alphaSnapshotRecorder = {
      initialize: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    };
    const runtime = new EvidenceCollectionRuntime({
      bridge: new CorrelatedAlertEvidenceBridge({
        evaluationId: 'alpha-runtime',
        sourceCommit: 'test',
        configurationFingerprint: 'test-config',
      }),
      collector: collector as never,
      alphaSnapshotRecorder: alphaSnapshotRecorder as never,
      clock: () => 1_001,
      setIntervalFn: () => 123 as unknown as NodeJS.Timeout,
      clearIntervalFn: vi.fn(),
    });
    await runtime.start();

    runtime.onPersistedLiveAlert(alert, context);
    runtime.onPersistedLiveAlert(secondAlert, context);
    runtime.onPersistedAlphaMarketContext(alphaInput(alert));
    runtime.onPersistedAlphaMarketContext(alphaInput(secondAlert));
    await runtime.processNow();
    await runtime.stop();

    expect(alphaSnapshotRecorder.record).toHaveBeenCalledTimes(2);
    expect(
      alphaSnapshotRecorder.record.mock.calls.map(
        (call) => call[0]?.evidence.alertId,
      ),
    ).toEqual([alert.id, secondAlert.id]);
  });

  it('blocks an alpha snapshot when its authoritative evidence write fails', async () => {
    const onError = vi.fn();
    const alphaSnapshotRecorder = {
      initialize: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    };
    const runtime = new EvidenceCollectionRuntime({
      bridge: new CorrelatedAlertEvidenceBridge({
        evaluationId: 'alpha-runtime',
        sourceCommit: 'test',
        configurationFingerprint: 'test-config',
      }),
      collector: {
        initialize: vi.fn(async () => undefined),
        recordQualifiedAlert: vi.fn(async () => {
          throw new Error('qualified write failed');
        }),
        processDueObservations: vi.fn(async () => 0),
      } as never,
      alphaSnapshotRecorder: alphaSnapshotRecorder as never,
      onError,
      clock: () => 1_001,
      setIntervalFn: () => 123 as unknown as NodeJS.Timeout,
      clearIntervalFn: vi.fn(),
    });
    await runtime.start();

    runtime.onPersistedLiveAlert(alert, context);
    runtime.onPersistedAlphaMarketContext(alphaInput(alert));
    await runtime.processNow();
    await runtime.stop();

    expect(alphaSnapshotRecorder.record).not.toHaveBeenCalled();
    expect(
      onError.mock.calls.some((call) =>
        String(call[0]).includes('qualified write failed'),
      ),
    ).toBe(true);
    expect(
      onError.mock.calls.some((call) =>
        String(call[0]).includes('Alpha snapshot blocked'),
      ),
    ).toBe(true);
  });

  it('expires missing alpha contexts so the bounded queue can recover', async () => {
    const secondAlert: CorrelatedAlert = {
      ...alert,
      id: 'correlated-alert:session-1:2',
      alertSequence: 2,
    };
    let now = 1_001;
    const onError = vi.fn();
    const alphaSnapshotRecorder = {
      initialize: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    };
    const runtime = new EvidenceCollectionRuntime({
      bridge: new CorrelatedAlertEvidenceBridge({
        evaluationId: 'alpha-runtime',
        sourceCommit: 'test',
        configurationFingerprint: 'test-config',
      }),
      collector: {
        initialize: vi.fn(async () => undefined),
        recordQualifiedAlert: vi.fn(async () => undefined),
        processDueObservations: vi.fn(async () => 0),
      } as never,
      alphaSnapshotRecorder: alphaSnapshotRecorder as never,
      maximumPendingAlphaEvidence: 1,
      maximumPendingAlphaEvidenceAgeMs: 100,
      onError,
      clock: () => now,
      setIntervalFn: () => 123 as unknown as NodeJS.Timeout,
      clearIntervalFn: vi.fn(),
    });
    await runtime.start();

    runtime.onPersistedLiveAlert(alert, context);
    now = 1_102;
    runtime.onPersistedLiveAlert(secondAlert, context);
    runtime.onPersistedAlphaMarketContext(alphaInput(secondAlert));
    await runtime.processNow();
    await runtime.stop();

    expect(alphaSnapshotRecorder.record).toHaveBeenCalledOnce();
    expect(
      alphaSnapshotRecorder.record.mock.calls[0]?.[0]?.evidence.alertId,
    ).toBe(secondAlert.id);
    expect(
      onError.mock.calls.some((call) =>
        String(call[0]).includes('Expired 1 pending alpha context'),
      ),
    ).toBe(true);
    expect(
      onError.mock.calls.some((call) =>
        String(call[0]).includes('limit reached'),
      ),
    ).toBe(false);
  });

  it('rejects invalid polling intervals', () => {
    expect(
      () =>
        new EvidenceCollectionRuntime({
          bridge: {} as never,
          collector: {} as never,
          intervalMs: 0,
        }),
    ).toThrow('intervalMs must be a positive safe integer');
    expect(
      () =>
        new EvidenceCollectionRuntime({
          bridge: {} as never,
          collector: {} as never,
          maximumPendingAlphaEvidence: 0,
        }),
    ).toThrow('maximumPendingAlphaEvidence');
    expect(
      () =>
        new EvidenceCollectionRuntime({
          bridge: {} as never,
          collector: {} as never,
          maximumPendingAlphaEvidenceAgeMs: 0,
        }),
    ).toThrow('maximumPendingAlphaEvidenceAgeMs');
  });
});
