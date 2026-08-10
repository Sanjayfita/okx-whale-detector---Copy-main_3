import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAlphaResearchEventSnapshot } from '../src/research/alphaResearchSnapshot';
import { CorrelatedAlertEvidenceBridge } from '../src/research/correlatedAlertEvidenceBridge';
import { evaluateEvidenceCanary } from '../src/research/evidenceCanary';
import type { EvidenceCollectBootstrap } from '../src/research/evidenceCollectBootstrap';
import { createEvidenceCollectRuntimeBundle } from '../src/research/evidenceCollectRuntimeFactory';
import { requireSafeEvidenceEvaluationId } from '../src/research/evidenceEvaluationId';
import { EvidenceEventInitializationStore } from '../src/research/evidenceEventInitializationStore';
import type { EvidenceProgressReport } from '../src/research/evidenceProgressInspector';
import { EvidenceCollectionRuntime } from '../src/research/evidenceCollectionRuntime';
import type { CorrelatedAlert } from '../src/types/correlatedAlert';
import type { CorrelatedAlertEvaluationContext } from '../src/types/correlatedAlertEvaluation';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true })),
  );
});

describe('evidence pipeline integrity repair', () => {
  it('rejects traversal and unexpanded PowerShell evaluation IDs', () => {
    expect(() => requireSafeEvidenceEvaluationId('$EvaluationId')).toThrow(
      'unexpanded PowerShell variable',
    );
    expect(() => requireSafeEvidenceEvaluationId('../escape')).toThrow(
      '3-128 characters',
    );
  });

  it('recovers an interrupted event transaction with one alert, one snapshot, and nine jobs', async () => {
    const evaluationDirectory = await mkdtemp(
      join(tmpdir(), 'event-recovery-'),
    );
    directories.push(evaluationDirectory);
    const horizonsMinutes = [
      0.08333333333333333, 0.25, 0.5, 1, 3, 5, 15, 30, 60,
    ] as const;
    const bootstrap: EvidenceCollectBootstrap = {
      evaluationDirectory,
      manifest: {
        schemaVersion: 1,
        evaluationId: 'eval-recovery',
        sourceCommit: 'abc123',
        configurationFingerprint: 'fingerprint',
        configuration: {},
        instruments: ['BTC-USDT'],
        horizonsMinutes,
        minimumCollectionDays: 30,
        minimumQualifiedAlerts: 1_000,
        minimumInstruments: 1,
        createdAt: 1_000,
        configurationChangesAllowed: false,
        liveOrderExecutionAllowed: false,
        orderExecutionAuthorized: false,
        dryRunOnly: true,
        transportDispatchAllowed: false,
        testnetExecutionAuthorized: false,
      },
      liveOrderExecutionAllowed: false,
    };
    await writeFile(
      join(evaluationDirectory, 'manifest.json'),
      `${JSON.stringify(bootstrap.manifest)}\n`,
      'utf8',
    );
    const alert: CorrelatedAlert = {
      id: 'alert-recovery-1',
      sourceSessionId: 'session-1',
      alertSequence: 1,
      symbol: 'BTC-USDT',
      severity: 'STRONG',
      eventType: 'NEW_SIGNAL',
      bias: 'BULLISH',
      relationship: 'OKX_ONLY',
      combinedConfidence: 82,
      alertImportance: 82,
      okxConfidence: 82,
      externalEffectiveConfidence: 0,
      externalSignalsUsed: 0,
      ignoredExternalSignals: 0,
      reason: 'OKX whale pressure only',
      createdAt: 1_000,
    };
    const evaluationContext: CorrelatedAlertEvaluationContext = {
      instId: 'BTC-USDT',
      instType: 'SPOT',
      okxBias: 'BULLISH',
      externalBias: 'NEUTRAL',
      sourceSignalTimestamp: 900,
      sourceMarketTimestamp: 950,
      referenceTimestamp: 1_000,
      referenceMidpoint: 100,
      referenceBestBid: 99.9,
      referenceBestAsk: 100.1,
      referenceSpread: 0.2,
      referenceSpreadPercent: 0.2,
    };
    const bridge = new CorrelatedAlertEvidenceBridge({
      evaluationId: 'eval-recovery',
      sourceCommit: 'abc123',
      configurationFingerprint: 'fingerprint',
      alertAdmissionPolicy: 'OKX_ONLY',
    });
    const evidence = bridge.createEvidence({
      alert,
      evaluationContext,
      recordedAt: 1_001,
    });
    const snapshot = createAlphaResearchEventSnapshot({
      evidence,
      marketContext: {
        instrumentId: 'BTC-USDT',
        detectedAt: 1_000,
        candles: [],
        orderBook: {
          eventTimestamp: 1_000,
          availabilityTimestamp: 1_000,
          bids: [{ price: 99.9, size: 2 }],
          asks: [{ price: 100.1, size: 2 }],
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
    const journal = new EvidenceEventInitializationStore(evaluationDirectory);
    await journal.initialize();
    await journal.begin(evidence, snapshot, 1_001);

    const bundle = createEvidenceCollectRuntimeBundle({
      bootstrap,
      readPrice: vi.fn(),
      clock: () => 1_001,
    });
    await bundle.runtime.start();
    await bundle.runtime.stop();

    const alerts = (
      await readFile(
        join(evaluationDirectory, 'qualified-alerts.ndjson'),
        'utf8',
      )
    )
      .trim()
      .split('\n');
    const snapshots = (
      await readFile(
        join(evaluationDirectory, 'alpha-snapshots.ndjson'),
        'utf8',
      )
    )
      .trim()
      .split('\n');
    const pending = JSON.parse(
      await readFile(
        join(evaluationDirectory, 'pending-observations.json'),
        'utf8',
      ),
    ) as { pending: unknown[] };
    const eventState = JSON.parse(
      await readFile(
        join(evaluationDirectory, 'event-initializations.json'),
        'utf8',
      ),
    ) as { pending: unknown[]; committedAlertIds: string[] };
    expect(alerts).toHaveLength(1);
    expect(snapshots).toHaveLength(1);
    expect(pending.pending).toHaveLength(9);
    expect(eventState.pending).toEqual([]);
    expect(eventState.committedAlertIds).toEqual([alert.id]);
  });

  it('fails the canary on scheduler gaps and passes exact admitted accounting', () => {
    const base = {
      invalidJsonRecordCount: 0,
      schemaInvalidRecordCount: 0,
      unexpectedInstrumentCount: 0,
      duplicateEventCount: 0,
      duplicateSnapshotCount: 0,
      duplicateObservationCount: 0,
      orphanObservationCount: 0,
      temporalInconsistencyCount: 0,
      criticalFailureCount: 0,
      missedObservationCount: 0,
      overduePendingObservationCount: 0,
      schedulerCoverageGapCount: 0,
      pendingEventInitializationCount: 0,
      missingSnapshotCount: 0,
      qualifiedAlertCount: 2,
      expectedObservationCount: 18,
      completedObservationCount: 2,
      pendingObservationCount: 16,
    } as unknown as EvidenceProgressReport;
    expect(evaluateEvidenceCanary(base).status).toBe('PASS');
    expect(
      evaluateEvidenceCanary({ ...base, schedulerCoverageGapCount: 1 }).status,
    ).toBe('FAIL');
  });

  it('durably fails closed before persisting an unexpected instrument', async () => {
    const health = {
      initialize: vi.fn(async () => undefined),
      isUnhealthy: vi.fn(() => false),
      fail: vi.fn(async () => undefined),
    };
    const bridge = { createEvidence: vi.fn() };
    const runtime = new EvidenceCollectionRuntime({
      bridge: bridge as never,
      collector: {
        initialize: vi.fn(async () => undefined),
        processDueObservations: vi.fn(async () => 0),
      } as never,
      alphaSnapshotRecorder: {
        initialize: vi.fn(async () => undefined),
      } as never,
      eventInitializationStore: {
        initialize: vi.fn(async () => undefined),
        getPending: vi.fn(() => []),
      } as never,
      healthStore: health as never,
      allowedInstrumentIds: ['BTC-USDT'],
      setIntervalFn: () => 1 as unknown as NodeJS.Timeout,
      clearIntervalFn: vi.fn(),
    });
    await runtime.start();
    runtime.onQualifiedMarketContext({
      alert: {
        id: 'unexpected-1',
        symbol: 'ETH-USDT',
      } as CorrelatedAlert,
      evaluationContext: {
        instId: 'ETH-USDT',
      } as CorrelatedAlertEvaluationContext,
      marketContext: null,
      failureReason: 'POINT_IN_TIME_CONTEXT_UNAVAILABLE',
    });
    await vi.waitFor(() => expect(runtime.isFailedClosed()).toBe(true));
    await runtime.stop();

    expect(bridge.createEvidence).not.toHaveBeenCalled();
    expect(health.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'UNEXPECTED_INSTRUMENT',
        instrumentId: 'ETH-USDT',
      }),
    );
  });
});
