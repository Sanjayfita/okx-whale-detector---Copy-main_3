import { describe, expect, it, vi } from 'vitest';

import type { CorrelatedMarketSignal } from '../src/external/core/ExternalSignalCorrelationEngine';
import type { EvidenceCollectBootstrap } from '../src/research/evidenceCollectBootstrap';
import type { createEvidenceCollectRuntimeBundle } from '../src/research/evidenceCollectRuntimeFactory';
import type { OKXLivePriceReader } from '../src/research/okxLivePriceReader';
import { runEvidenceCollectCommand } from '../src/tools/collectEvidence';
import type { MarketEvaluation } from '../src/types/marketEvaluation';

const bootstrap: EvidenceCollectBootstrap = {
  evaluationDirectory: 'data/evaluations/eval-okx-only-test',
  liveOrderExecutionAllowed: false,
  manifest: {
    schemaVersion: 1,
    evaluationId: 'eval-okx-only-test',
    sourceCommit: 'abc123',
    configurationFingerprint: 'fingerprint',
    configuration: {},
    instruments: ['BTC-USDT'],
    horizonsMinutes: [1, 5, 15, 30, 60],
    minimumCollectionDays: 30,
    minimumQualifiedAlerts: 1_000,
    minimumInstruments: 1,
    createdAt: 1,
    configurationChangesAllowed: false,
    liveOrderExecutionAllowed: false,
    orderExecutionAuthorized: false,
    dryRunOnly: true,
    transportDispatchAllowed: false,
    testnetExecutionAuthorized: false,
  },
};

const okxOnlyEvaluation = (): MarketEvaluation => {
  const correlatedSignal: CorrelatedMarketSignal = {
    symbol: 'BTC-USDT',
    bias: 'BULLISH',
    confidence: 75,
    alertImportance: 75,
    okxBias: 'BULLISH',
    okxConfidence: 75,
    externalBias: 'NEUTRAL',
    externalConfidence: 0,
    agreement: 'OKX_ONLY',
    bullishExternalScore: 0,
    bearishExternalScore: 0,
    neutralExternalSignals: 0,
    consideredSignals: 0,
    ignoredSignals: 0,
    contributions: [],
    reason: 'No relevant fresh external signals; using OKX bullish context only.',
    timestamp: 1_000,
  };

  return {
    marketSignal: {
      bias: 'BULLISH',
      confidence: 75,
      bidPressure: 87.5,
      askPressure: 12.5,
      netPressure: 75,
      reason: 'Bid whale pressure exceeds the neutral band',
      timestamp: 1_000,
    },
    correlatedSignal,
  };
};

describe('evidence collection OKX-only policy', () => {
  it('injects an OKX-only alert engine and a disabled external runtime', async () => {
    const runtimeStart = vi.fn(async () => undefined);
    const runtimeStop = vi.fn(async () => undefined);
    const leaseAcquire = vi.fn(async () => undefined);
    const leaseRelease = vi.fn(async () => undefined);
    const appShutdown = vi.fn(async () => undefined);
    let disabledExternalStart: ReturnType<typeof vi.spyOn> | undefined;

    const createRuntimeBundle = vi.fn(() => ({
      runtime: {
        start: runtimeStart,
        stop: runtimeStop,
        onPersistedLiveAlert: vi.fn(),
        onPersistedAlphaMarketContext: vi.fn(),
      },
      liveOrderExecutionAllowed: false,
    })) as unknown as typeof createEvidenceCollectRuntimeBundle;

    const handle = await runEvidenceCollectCommand('eval-okx-only-test', {
      loadBootstrap: vi.fn(async () => bootstrap),
      createPriceReader: () =>
        ({ readPrice: vi.fn() }) as unknown as OKXLivePriceReader,
      createRuntimeBundle,
      createEvaluationLease: vi.fn(() => ({
        acquire: leaseAcquire,
        release: leaseRelease,
      })),
      createAppRuntime: vi.fn(async (dependencies) => {
        expect(
          dependencies.correlatedAlertEngine.evaluate(
            okxOnlyEvaluation(),
            1_000,
          ),
        ).toMatchObject({
          relationship: 'OKX_ONLY',
          externalSignalsUsed: 0,
          bias: 'BULLISH',
        });
        expect(
          dependencies.externalSignalCorrelationService.getStoredSize(),
        ).toBe(0);
        disabledExternalStart = vi.spyOn(
          dependencies.polymarketRuntime,
          'start',
        );
        return {
          polymarketRuntime: dependencies.polymarketRuntime,
          shutdown: appShutdown,
        };
      }),
      registerSignal: vi.fn(),
      log: vi.fn(),
      error: vi.fn(),
    });

    await Promise.resolve();

    expect(runtimeStart).toHaveBeenCalledOnce();
    expect(leaseAcquire).toHaveBeenCalledOnce();
    expect(disabledExternalStart).toHaveBeenCalledOnce();

    await handle.stop();

    expect(appShutdown).toHaveBeenCalledOnce();
    expect(runtimeStop).toHaveBeenCalledOnce();
    expect(leaseRelease).toHaveBeenCalledOnce();
  });
});
