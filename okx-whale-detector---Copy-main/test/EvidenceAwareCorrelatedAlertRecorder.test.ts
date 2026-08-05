import { describe, expect, it, vi } from 'vitest';
import { EvidenceAwareCorrelatedAlertRecorder } from '../src/research/evidenceAwareCorrelatedAlertRecorder';
import type { CorrelatedAlert } from '../src/types/correlatedAlert';
import type { CorrelatedAlertRecordContext } from '../src/types/correlatedAlertEvaluation';

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

const liveContext: CorrelatedAlertRecordContext = {
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

const writerFactory = () => ({
  append: () => ({ writeMs: 0, fsyncMs: 0 }),
  close: () => undefined,
});

describe('EvidenceAwareCorrelatedAlertRecorder', () => {
  it('forwards a persisted live alert to the evidence callback', () => {
    const onPersistedLiveAlert = vi.fn();
    const recorder = new EvidenceAwareCorrelatedAlertRecorder({
      onPersistedLiveAlert,
      writerFactory,
      clock: () => 1_001,
    });

    const result = recorder.record(alert, liveContext);

    expect(result).toEqual({ persisted: true, fsynced: true });
    expect(onPersistedLiveAlert).toHaveBeenCalledOnce();
    expect(onPersistedLiveAlert).toHaveBeenCalledWith(alert, liveContext);
  });

  it('does not forward replay alerts into live evidence collection', () => {
    const onPersistedLiveAlert = vi.fn();
    const recorder = new EvidenceAwareCorrelatedAlertRecorder({
      onPersistedLiveAlert,
      writerFactory,
      clock: () => 1_001,
    });

    recorder.record(alert, { ...liveContext, provenance: 'REPLAY' });

    expect(onPersistedLiveAlert).not.toHaveBeenCalled();
  });

  it('does not forward an alert when persistence fails', () => {
    const onPersistedLiveAlert = vi.fn();
    const recorder = new EvidenceAwareCorrelatedAlertRecorder({
      onPersistedLiveAlert,
      writerFactory: () => ({
        append: () => {
          throw new Error('disk unavailable');
        },
        close: () => undefined,
      }),
      warn: () => undefined,
      clock: () => 1_001,
    });

    const result = recorder.record(alert, liveContext);

    expect(result.persisted).toBe(false);
    expect(onPersistedLiveAlert).not.toHaveBeenCalled();
  });
});
