import { describe, expect, it } from 'vitest';

import type { AlertOutcomeObservation } from '../src/research/alertOutcomeObservation';
import type { QualifiedAlertEvidenceRecord } from '../src/research/qualifiedAlertEvidence';
import {
  applyBenjaminiHochberg,
  blockBootstrapMeanConfidenceInterval,
  createStatisticalValidationReport,
} from '../src/research/statisticalValidation';

const createEvidence = (
  count: number,
): {
  alerts: QualifiedAlertEvidenceRecord[];
  outcomes: AlertOutcomeObservation[];
} => {
  const alerts: QualifiedAlertEvidenceRecord[] = [];
  const outcomes: AlertOutcomeObservation[] = [];

  for (let index = 0; index < count; index += 1) {
    const detectedAt = 1_000_000 + index * 2 * 60 * 60_000;
    const alertId = `alert-${index}`;
    alerts.push({
      schemaVersion: 1,
      evaluationId: 'eval-statistics',
      alertId,
      instrumentId: index % 2 === 0 ? 'BTC-USDT' : 'ETH-USDT',
      detectedAt,
      recordedAt: detectedAt + 1,
      direction: 'BULLISH',
      signalType: 'BUY_PRESSURE',
      confidence: 80,
      referencePrice: 100,
      bestBid: 99.9,
      bestAsk: 100.1,
      spreadPercent: 0.2,
      sourceCommit: 'test',
      configurationFingerprint: 'test',
      qualified: true,
      liveOrderExecutionAllowed: false,
    });
    outcomes.push({
      schemaVersion: 1,
      evaluationId: 'eval-statistics',
      alertId,
      instrumentId: alerts.at(-1)?.instrumentId ?? 'BTC-USDT',
      detectedAt,
      horizonMinutes: 1,
      observedAt: detectedAt + 60_000,
      referencePrice: 100,
      observedPrice: 101,
      rawReturnPercent: 1,
      directionAdjustedReturnPercent: 1,
      maximumFavorableExcursionPercent: 1.2,
      maximumAdverseExcursionPercent: 0.2,
      complete: true,
      liveOrderExecutionAllowed: false,
    });
  }

  return { alerts, outcomes };
};

describe('statistical validation', () => {
  it('creates a deterministic block-bootstrap interval', () => {
    const values = [0.5, 1, 1.5, 2, 2.5];
    let seed = 0;
    const random = (): number => {
      seed = (seed + 0.37) % 1;
      return seed;
    };

    const interval = blockBootstrapMeanConfidenceInterval(values, {
      iterations: 100,
      blockSize: 2,
      random,
    });

    expect(interval.mean).toBe(1.5);
    expect(interval.lower).toBeLessThanOrEqual(interval.mean);
    expect(interval.upper).toBeGreaterThanOrEqual(interval.mean);
  });

  it('rejects invalid bootstrap inputs without entering an unbounded loop', () => {
    expect(() =>
      blockBootstrapMeanConfidenceInterval([1], { blockSize: Number.NaN }),
    ).toThrow('blockSize');
    expect(() =>
      blockBootstrapMeanConfidenceInterval([Number.POSITIVE_INFINITY]),
    ).toThrow('finite');
    expect(() =>
      blockBootstrapMeanConfidenceInterval([1], {
        iterations: 1,
        random: () => 1,
      }),
    ).toThrow('random');
  });

  it('uses a deterministic default bootstrap stream', () => {
    const first = blockBootstrapMeanConfidenceInterval([1, -1, 2, -2], {
      iterations: 100,
      blockSize: 2,
    });
    const second = blockBootstrapMeanConfidenceInterval([1, -1, 2, -2], {
      iterations: 100,
      blockSize: 2,
    });

    expect(second).toEqual(first);
  });

  it('applies Benjamini-Hochberg correction without changing input order', () => {
    const results = applyBenjaminiHochberg([
      { key: 'a', pValue: 0.001 },
      { key: 'b', pValue: 0.02 },
      { key: 'c', pValue: 0.8 },
    ]);

    expect(results.map((result) => result.key)).toEqual(['a', 'b', 'c']);
    expect(results[0]?.rejected).toBe(true);
    expect(results[2]?.rejected).toBe(false);
  });

  it('rejects malformed multiple-testing inputs', () => {
    expect(() =>
      applyBenjaminiHochberg([{ key: 'invalid', pValue: Number.NaN }]),
    ).toThrow('p-values');
    expect(() =>
      applyBenjaminiHochberg([
        { key: 'duplicate', pValue: 0.1 },
        { key: 'duplicate', pValue: 0.2 },
      ]),
    ).toThrow('unique');
  });

  it('requires positive out-of-sample evidence before qualification', () => {
    const { alerts, outcomes } = createEvidence(30);
    const report = createStatisticalValidationReport({
      generatedAt: 9_999,
      evaluationId: 'eval-statistics',
      alerts,
      outcomes,
      policy: {
        startingCapital: 10_000,
        positionNotional: 100,
        roundTripCostPercent: 0.2,
        primaryHorizonMinutes: 1,
      },
      options: {
        minimumSampleSize: 30,
        bootstrapIterations: 200,
        bootstrapBlockSize: 3,
        purgeMs: 30 * 60_000,
        randomSeed: 123,
      },
    });

    expect(report.sampleRequirementMet).toBe(true);
    expect(report.independentAlerts).toBe(30);
    expect(report.overallConfidenceInterval.lower).toBeGreaterThan(0);
    expect(report.chronologicalSplit.testCount).toBeGreaterThan(0);
    expect(report.chronologicalSplit.testMeanNetReturnPercent).toBeGreaterThan(
      0,
    );
    expect(report.readyForQualification).toBe(true);
    expect(report.liveOrderExecutionAllowed).toBe(false);
    expect(report.orderExecutionAuthorized).toBe(false);
    expect(
      report.byRegime.every(
        (regime) =>
          regime.basis === 'OUTCOME_PATH_VOLATILITY' &&
          !regime.availableAtDecisionTime,
      ),
    ).toBe(true);
  });

  it('blocks qualification for insufficient data', () => {
    const { alerts, outcomes } = createEvidence(5);
    const report = createStatisticalValidationReport({
      generatedAt: 9_999,
      evaluationId: 'eval-statistics',
      alerts,
      outcomes,
      policy: {
        startingCapital: 10_000,
        positionNotional: 100,
        roundTripCostPercent: 0.2,
        primaryHorizonMinutes: 1,
      },
      options: {
        minimumSampleSize: 100,
        bootstrapIterations: 20,
      },
    });

    expect(report.readyForQualification).toBe(false);
    expect(report.reasons[0]).toContain('Requires at least 100');
  });

  it('counts one alert with multiple horizons as one independent sample', () => {
    const { alerts, outcomes } = createEvidence(1);
    const baseOutcome = outcomes[0];

    if (!baseOutcome) {
      throw new Error('Expected a base outcome');
    }

    const repeatedHorizons: AlertOutcomeObservation[] = (
      [1, 5, 15, 30, 60] as const
    ).map((horizonMinutes) => ({
      ...baseOutcome,
      horizonMinutes,
      observedAt: baseOutcome.detectedAt + horizonMinutes * 60_000,
    }));
    const report = createStatisticalValidationReport({
      generatedAt: 9_999,
      evaluationId: 'eval-statistics',
      alerts,
      outcomes: repeatedHorizons,
      policy: {
        startingCapital: 10_000,
        positionNotional: 100,
        roundTripCostPercent: 0.2,
        primaryHorizonMinutes: 1,
      },
      options: { minimumSampleSize: 2, bootstrapIterations: 20 },
    });

    expect(report.matchedObservations).toBe(5);
    expect(report.independentAlerts).toBe(1);
    expect(report.sampleRequirementMet).toBe(false);
  });

  it('purges training labels that overlap a later split boundary', () => {
    const { alerts, outcomes } = createEvidence(10);
    const shiftedAlerts = alerts.map((currentAlert, index) => {
      const detectedAt = 1_000_000 + index * 10 * 60_000;
      return { ...currentAlert, detectedAt, recordedAt: detectedAt + 1 };
    });
    const shiftedOutcomes = outcomes.map((currentOutcome, index) => {
      const detectedAt = 1_000_000 + index * 10 * 60_000;
      return {
        ...currentOutcome,
        detectedAt,
        horizonMinutes: 60 as const,
        observedAt: detectedAt + 60 * 60_000,
      };
    });

    const report = createStatisticalValidationReport({
      generatedAt: 9_999,
      evaluationId: 'eval-statistics',
      alerts: shiftedAlerts,
      outcomes: shiftedOutcomes,
      policy: {
        startingCapital: 10_000,
        positionNotional: 100,
        roundTripCostPercent: 0.2,
        primaryHorizonMinutes: 60,
      },
      options: {
        minimumSampleSize: 1,
        bootstrapIterations: 20,
        purgeMs: 0,
      },
    });

    expect(report.chronologicalSplit.trainCount).toBe(0);
  });
});
