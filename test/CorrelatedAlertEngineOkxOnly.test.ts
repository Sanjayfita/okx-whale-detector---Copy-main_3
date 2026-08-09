import { describe, expect, it } from 'vitest';

import { CorrelatedAlertEngine } from '../src/alerts/CorrelatedAlertEngine';
import type { CorrelatedMarketSignal } from '../src/external/core/ExternalSignalCorrelationEngine';
import type { MarketEvaluation } from '../src/types/marketEvaluation';

const createOkxOnlyEvaluation = (
  overrides: Partial<CorrelatedMarketSignal> = {},
): MarketEvaluation => {
  const correlatedSignal: CorrelatedMarketSignal = {
    symbol: 'BTC-USDT',
    bias: 'BULLISH',
    confidence: 72,
    alertImportance: 72,
    okxBias: 'BULLISH',
    okxConfidence: 72,
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
    ...overrides,
  };

  return {
    marketSignal: {
      bias: correlatedSignal.okxBias,
      confidence: correlatedSignal.okxConfidence,
      reason: 'OKX whale pressure is directionally bullish.',
      bidPressure: 86,
      askPressure: 14,
      netPressure: 72,
      timestamp: correlatedSignal.timestamp,
    },
    correlatedSignal,
  };
};

describe('CorrelatedAlertEngine OKX-only policy', () => {
  it('keeps OKX-only alerts disabled by default', () => {
    const engine = new CorrelatedAlertEngine({
      sourceSessionId: 'default-policy',
      clock: () => 1_000,
    });

    expect(engine.evaluate(createOkxOnlyEvaluation())).toBeUndefined();
  });

  it('emits an OKX-only alert when explicitly enabled', () => {
    const engine = new CorrelatedAlertEngine({
      sourceSessionId: 'okx-only-policy',
      okxOnlyAlertsEnabled: true,
      minimumOkxOnlyAlertImportance: 55,
      clock: () => 1_000,
    });

    expect(engine.evaluate(createOkxOnlyEvaluation())).toMatchObject({
      id: 'correlated-alert:okx-only-policy:1',
      eventType: 'NEW_SIGNAL',
      relationship: 'OKX_ONLY',
      bias: 'BULLISH',
      combinedConfidence: 72,
      alertImportance: 72,
      externalSignalsUsed: 0,
      externalEffectiveConfidence: 0,
      createdAt: 1_000,
    });
  });

  it('still rejects a below-threshold OKX-only signal', () => {
    const engine = new CorrelatedAlertEngine({
      sourceSessionId: 'okx-only-threshold',
      okxOnlyAlertsEnabled: true,
      minimumOkxOnlyAlertImportance: 60,
      clock: () => 1_000,
    });

    expect(
      engine.evaluate(
        createOkxOnlyEvaluation({
          confidence: 59.99,
          alertImportance: 59.99,
          okxConfidence: 59.99,
        }),
      ),
    ).toBeUndefined();
  });

  it('rejects inconsistent OKX-only evaluations containing external signals', () => {
    const engine = new CorrelatedAlertEngine({
      sourceSessionId: 'okx-only-integrity',
      okxOnlyAlertsEnabled: true,
      minimumOkxOnlyAlertImportance: 55,
      clock: () => 1_000,
    });

    expect(
      engine.evaluate(createOkxOnlyEvaluation({ consideredSignals: 1 })),
    ).toBeUndefined();
  });
});
