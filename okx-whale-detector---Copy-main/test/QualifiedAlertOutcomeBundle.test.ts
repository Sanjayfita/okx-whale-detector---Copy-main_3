import { describe, expect, it } from 'vitest';

import {
  ALERT_OUTCOME_HORIZONS_MINUTES,
  createAlertOutcomeObservation,
} from '../src/research/alertOutcomeObservation';
import { createQualifiedAlertEvidenceRecord } from '../src/research/qualifiedAlertEvidence';
import { createQualifiedAlertOutcomeBundle } from '../src/research/qualifiedAlertOutcomeBundle';
import { validateQualifiedAlertOutcomeBundle } from '../src/research/qualifiedAlertOutcomeBundle';

const evidence = createQualifiedAlertEvidenceRecord({
  evaluationId: 'evaluation-1',
  alertId: 'alert-1',
  instrumentId: 'BTC-USDT',
  detectedAt: 1_000_000,
  recordedAt: 1_000_100,
  direction: 'BULLISH',
  signalType: 'WHALE_WALL',
  confidence: 80,
  referencePrice: 100,
  bestBid: 99.9,
  bestAsk: 100.1,
  spreadPercent: 0.2,
  sourceCommit: 'abc123',
  configurationFingerprint: 'config-1',
});

const observation = (horizonMinutes: 1 | 5 | 15 | 30 | 60) =>
  createAlertOutcomeObservation({
    evaluationId: evidence.evaluationId,
    alertId: evidence.alertId,
    instrumentId: evidence.instrumentId,
    detectedAt: evidence.detectedAt,
    horizonMinutes,
    observedAt: evidence.detectedAt + horizonMinutes * 60_000,
    referencePrice: evidence.referencePrice,
    observedPrice: 101,
    rawReturnPercent: 1,
    directionAdjustedReturnPercent: 1,
    maximumFavorableExcursionPercent: 1.5,
    maximumAdverseExcursionPercent: 0.5,
  });

describe('createQualifiedAlertOutcomeBundle', () => {
  it('creates a complete ordered bundle for all required horizons', () => {
    const bundle = createQualifiedAlertOutcomeBundle({
      evidence,
      observations: [...ALERT_OUTCOME_HORIZONS_MINUTES]
        .reverse()
        .map(observation),
    });

    expect(bundle.complete).toBe(true);
    expect(bundle.liveOrderExecutionAllowed).toBe(false);
    expect(bundle.completeHorizons).toEqual([1, 5, 15, 30, 60]);
    expect(bundle.observations.map((item) => item.horizonMinutes)).toEqual([
      1, 5, 15, 30, 60,
    ]);
  });

  it('rejects duplicate and therefore incomplete horizon sets', () => {
    expect(() =>
      createQualifiedAlertOutcomeBundle({
        evidence,
        observations: [
          observation(1),
          observation(5),
          observation(15),
          observation(30),
          observation(30),
        ],
      }),
    ).toThrow('Duplicate alert outcome horizons are not allowed');
  });

  it('rejects observations belonging to another alert', () => {
    const mismatched = {
      ...observation(60),
      alertId: 'another-alert',
    };

    expect(() =>
      createQualifiedAlertOutcomeBundle({
        evidence,
        observations: [
          observation(1),
          observation(5),
          observation(15),
          observation(30),
          mismatched,
        ],
      }),
    ).toThrow(
      'Every observation must match the qualified alert evidence record',
    );
  });

  it('rejects a directionally inverted label and a forged complete envelope', () => {
    const inverted = {
      ...observation(60),
      directionAdjustedReturnPercent: -1,
    };
    expect(() =>
      createQualifiedAlertOutcomeBundle({
        evidence,
        observations: [
          observation(1),
          observation(5),
          observation(15),
          observation(30),
          inverted,
        ],
      }),
    ).toThrow('does not match the alert direction');

    const complete = createQualifiedAlertOutcomeBundle({
      evidence,
      observations: ALERT_OUTCOME_HORIZONS_MINUTES.map(observation),
    });
    expect(() =>
      validateQualifiedAlertOutcomeBundle({
        ...complete,
        completeHorizons: [1, 5, 15, 30, 30],
      }),
    ).toThrow('bundle horizons');
  });
});
