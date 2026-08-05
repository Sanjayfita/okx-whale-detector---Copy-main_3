import { describe, expect, it } from 'vitest';

import { CorrelatedAlertEvidenceBridge } from '../src/research/correlatedAlertEvidenceBridge';
import type { CorrelatedAlert } from '../src/types/correlatedAlert';
import type { CorrelatedAlertEvaluationContext } from '../src/types/correlatedAlertEvaluation';

const alert: CorrelatedAlert = {
  id: 'alert-1',
  sourceSessionId: 'session-1',
  alertSequence: 1,
  symbol: 'BTC-USDT',
  severity: 'STRONG',
  eventType: 'AGREEMENT',
  bias: 'BULLISH',
  relationship: 'AGREEMENT',
  combinedConfidence: 84,
  alertImportance: 90,
  okxConfidence: 82,
  externalEffectiveConfidence: 86,
  externalSignalsUsed: 2,
  ignoredExternalSignals: 0,
  reason: 'Bullish agreement',
  createdAt: 1_000,
};

const okxOnlyAlert: CorrelatedAlert = {
  ...alert,
  eventType: 'NEW_SIGNAL',
  relationship: 'OKX_ONLY',
  combinedConfidence: 82,
  alertImportance: 82,
  externalEffectiveConfidence: 0,
  externalSignalsUsed: 0,
  reason: 'OKX whale pressure only',
};

const evaluationContext: CorrelatedAlertEvaluationContext = {
  instId: 'BTC-USDT',
  instType: 'SPOT',
  okxBias: 'BULLISH',
  externalBias: 'BULLISH',
  sourceSignalTimestamp: 900,
  sourceMarketTimestamp: 950,
  referenceTimestamp: 1_000,
  referenceMidpoint: 100,
  referenceBestBid: 99.9,
  referenceBestAsk: 100.1,
  referenceSpread: 0.2,
  referenceSpreadPercent: 0.2,
};

describe('CorrelatedAlertEvidenceBridge', () => {
  it('converts a directional correlated alert into frozen evaluation evidence', () => {
    const bridge = new CorrelatedAlertEvidenceBridge({
      evaluationId: 'eval-1',
      sourceCommit: 'abc123',
      configurationFingerprint: 'fingerprint-1',
    });

    const evidence = bridge.createEvidence({
      alert,
      evaluationContext,
      recordedAt: 1_010,
    });

    expect(evidence).toMatchObject({
      evaluationId: 'eval-1',
      alertId: 'alert-1',
      instrumentId: 'BTC-USDT',
      direction: 'BULLISH',
      signalType: 'AGREEMENT:AGREEMENT:STRONG',
      confidence: 84,
      referencePrice: 100,
      qualified: true,
      liveOrderExecutionAllowed: false,
    });
    expect(Object.isFrozen(evidence)).toBe(true);
  });

  it('admits only zero-external OKX_ONLY alerts under the corrected policy', () => {
    const bridge = new CorrelatedAlertEvidenceBridge({
      evaluationId: 'eval-1',
      sourceCommit: 'abc123',
      configurationFingerprint: 'fingerprint-1',
      alertAdmissionPolicy: 'OKX_ONLY',
    });

    expect(
      bridge.createEvidence({
        alert: okxOnlyAlert,
        evaluationContext,
        recordedAt: 1_010,
      }),
    ).toMatchObject({
      signalType: 'NEW_SIGNAL:OKX_ONLY:STRONG',
      confidence: 82,
    });

    expect(() =>
      bridge.createEvidence({
        alert,
        evaluationContext,
        recordedAt: 1_010,
      }),
    ).toThrow('zero external contribution');

    expect(() =>
      bridge.createEvidence({
        alert: { ...okxOnlyAlert, externalSignalsUsed: 1 },
        evaluationContext,
        recordedAt: 1_010,
      }),
    ).toThrow('zero external contribution');
  });

  it('rejects neutral alerts and symbol mismatches', () => {
    const bridge = new CorrelatedAlertEvidenceBridge({
      evaluationId: 'eval-1',
      sourceCommit: 'abc123',
      configurationFingerprint: 'fingerprint-1',
    });

    expect(() =>
      bridge.createEvidence({
        alert: { ...alert, bias: 'NEUTRAL' },
        evaluationContext,
        recordedAt: 1_010,
      }),
    ).toThrow('Only directional correlated alerts qualify for evidence');

    expect(() =>
      bridge.createEvidence({
        alert,
        evaluationContext: { ...evaluationContext, instId: 'ETH-USDT' },
        recordedAt: 1_010,
      }),
    ).toThrow('Alert symbol does not match its evaluation context');
  });
});
