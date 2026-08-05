import { describe, expect, it } from 'vitest';

import type { AlertOutcomeObservation } from '../src/research/alertOutcomeObservation';
import { createEvidenceProfitabilityReport } from '../src/research/evidenceProfitability';
import type { QualifiedAlertEvidenceRecord } from '../src/research/qualifiedAlertEvidence';

const alert = (
  overrides: Partial<QualifiedAlertEvidenceRecord> = {},
): QualifiedAlertEvidenceRecord => ({
  schemaVersion: 1,
  evaluationId: 'eval-test',
  alertId: 'alert-1',
  instrumentId: 'BTC-USDT',
  detectedAt: 1_000,
  recordedAt: 1_001,
  direction: 'BULLISH',
  signalType: 'BUY_PRESSURE',
  confidence: 80,
  referencePrice: 100,
  bestBid: 99.9,
  bestAsk: 100.1,
  spreadPercent: 0.2,
  sourceCommit: 'commit',
  configurationFingerprint: 'fingerprint',
  qualified: true,
  liveOrderExecutionAllowed: false,
  ...overrides,
});

const outcome = (
  overrides: Partial<AlertOutcomeObservation> = {},
): AlertOutcomeObservation => ({
  schemaVersion: 1,
  evaluationId: 'eval-test',
  alertId: 'alert-1',
  instrumentId: 'BTC-USDT',
  detectedAt: 1_000,
  horizonMinutes: 15,
  observedAt: 901_000,
  referencePrice: 100,
  observedPrice: 101,
  rawReturnPercent: 1,
  directionAdjustedReturnPercent: 1,
  maximumFavorableExcursionPercent: 1.2,
  maximumAdverseExcursionPercent: 0.3,
  complete: true,
  liveOrderExecutionAllowed: false,
  ...overrides,
});

describe('createEvidenceProfitabilityReport', () => {
  it('calculates independent primary-horizon cost-adjusted profitability', () => {
    const report = createEvidenceProfitabilityReport({
      generatedAt: 1_000_000,
      evaluationId: 'eval-test',
      alerts: [
        alert(),
        alert({
          alertId: 'alert-2',
          direction: 'BEARISH',
          instrumentId: 'ETH-USDT',
        }),
      ],
      outcomes: [
        outcome(),
        outcome({
          alertId: 'alert-2',
          instrumentId: 'ETH-USDT',
          observedPrice: 100.5,
          rawReturnPercent: 0.5,
          directionAdjustedReturnPercent: -0.5,
          maximumFavorableExcursionPercent: 0.4,
          maximumAdverseExcursionPercent: 0.8,
        }),
        outcome({
          horizonMinutes: 1,
          observedAt: 61_000,
          observedPrice: 110,
          rawReturnPercent: 10,
          directionAdjustedReturnPercent: 10,
        }),
      ],
      policy: { positionNotional: 100, roundTripCostPercent: 0.2 },
    });

    expect(report.policy.primaryHorizonMinutes).toBe(15);
    expect(report.overall.key).toBe('INDEPENDENT_PRIMARY_15m');
    expect(report.overall.observations).toBe(2);
    expect(report.overall.wins).toBe(1);
    expect(report.overall.losses).toBe(1);
    expect(report.overall.averageGrossReturnPercent).toBe(0.25);
    expect(report.overall.averageNetReturnPercent).toBe(0.05);
    expect(report.overall.hypotheticalNetPnlUsdt).toBe(0.1);
    expect(report.byHorizon.map((group) => group.key)).toEqual(['1m', '15m']);
    expect(report.byInstrument).toHaveLength(2);
    expect(report.primaryHorizonCompleteAlerts).toBe(2);
    expect(report.independentPrimaryHorizonAlerts).toBe(2);
    expect(report.dependentPrimaryHorizonAlerts).toBe(0);
    expect(report.insufficientData).toBe(true);
    expect(report.liveOrderExecutionAllowed).toBe(false);
    expect(report.orderExecutionAuthorized).toBe(false);
  });

  it('does not count one alert as five headline trades', () => {
    const horizons = [1, 5, 15, 30, 60] as const;
    const report = createEvidenceProfitabilityReport({
      generatedAt: 4_000_000,
      evaluationId: 'eval-test',
      alerts: [alert()],
      outcomes: horizons.map((horizonMinutes) =>
        outcome({
          horizonMinutes,
          observedAt: 1_000 + horizonMinutes * 60_000,
        }),
      ),
    });

    expect(report.completedObservations).toBe(5);
    expect(report.byHorizon).toHaveLength(5);
    expect(report.overall.observations).toBe(1);
    expect(report.overall.hypotheticalNetPnlUsdt).toBe(0.8);
  });

  it('excludes overlapping primary-horizon alerts from headline metrics', () => {
    const secondDetectedAt = 10 * 60_000;
    const report = createEvidenceProfitabilityReport({
      generatedAt: 2_000_000,
      evaluationId: 'eval-test',
      alerts: [
        alert(),
        alert({
          alertId: 'alert-2',
          detectedAt: secondDetectedAt,
          recordedAt: secondDetectedAt,
        }),
      ],
      outcomes: [
        outcome(),
        outcome({
          alertId: 'alert-2',
          detectedAt: secondDetectedAt,
          observedAt: secondDetectedAt + 15 * 60_000,
        }),
      ],
    });

    expect(report.primaryHorizonCompleteAlerts).toBe(2);
    expect(report.independentPrimaryHorizonAlerts).toBe(1);
    expect(report.dependentPrimaryHorizonAlerts).toBe(1);
    expect(report.overall.observations).toBe(1);
  });

  it('counts observations without matching qualified alerts', () => {
    const report = createEvidenceProfitabilityReport({
      generatedAt: 1_000_000,
      evaluationId: 'eval-test',
      alerts: [],
      outcomes: [outcome()],
    });

    expect(report.unmatchedObservations).toBe(1);
    expect(report.overall.observations).toBe(0);
  });

  it('does not treat unavailable path excursions as observed zeroes', () => {
    const report = createEvidenceProfitabilityReport({
      generatedAt: 1_000_000,
      evaluationId: 'eval-test',
      alerts: [alert()],
      outcomes: [
        outcome({
          maximumFavorableExcursionPercent: 0,
          maximumAdverseExcursionPercent: 0,
          excursionMeasurement: 'UNAVAILABLE',
        }),
      ],
    });

    expect(report.overall.excursionSampleSize).toBe(0);
    expect(report.overall.averageMfePercent).toBeNull();
    expect(report.overall.averageMaePercent).toBeNull();
  });

  it('rejects duplicate and cross-evaluation evidence from the calculation', () => {
    const report = createEvidenceProfitabilityReport({
      generatedAt: 1_000_000,
      evaluationId: 'eval-test',
      alerts: [
        alert(),
        alert(),
        alert({ alertId: 'foreign', evaluationId: 'another-evaluation' }),
      ],
      outcomes: [
        outcome(),
        outcome(),
        outcome({ alertId: 'foreign', evaluationId: 'another-evaluation' }),
      ],
    });

    expect(report.qualifiedAlerts).toBe(1);
    expect(report.completedObservations).toBe(1);
    expect(report.overall.observations).toBe(1);
    expect(report.malformedRecords).toBe(4);
  });

  it('rejects an outcome whose identity or direction does not match its alert', () => {
    const report = createEvidenceProfitabilityReport({
      generatedAt: 1_000_000,
      evaluationId: 'eval-test',
      alerts: [alert()],
      outcomes: [
        outcome({ instrumentId: 'ETH-USDT' }),
        outcome({
          horizonMinutes: 5,
          observedAt: 301_000,
          directionAdjustedReturnPercent: -1,
        }),
      ],
    });

    expect(report.completedObservations).toBe(0);
    expect(report.overall.observations).toBe(0);
    expect(report.malformedRecords).toBe(2);
  });
});
