import { describe, expect, it } from 'vitest';

import { createAlertOutcomeObservation } from '../src/research/alertOutcomeObservation';
import {
  calculateStrategyReturnMetrics,
  evaluateTradeManagementPolicy,
} from '../src/research/tradeManagementResearch';

const createObservation = (input: {
  readonly alertId: string;
  readonly horizonMinutes?: 5 | 15;
  readonly terminalReturnPercent: number;
  readonly favorableExcursionPercent: number;
  readonly adverseExcursionPercent: number;
  readonly excursionMeasurement?: 'OBSERVED_PATH' | 'UNAVAILABLE';
}) => {
  const detectedAt =
    1_800_000_000_000 + Number(input.alertId.replace(/\D/g, '')) * 60_000;
  const horizonMinutes = input.horizonMinutes ?? 15;
  return createAlertOutcomeObservation({
    evaluationId: 'trade-management-test',
    alertId: input.alertId,
    instrumentId: 'BTC-USDT',
    detectedAt,
    horizonMinutes,
    observedAt: detectedAt + horizonMinutes * 60_000,
    referencePrice: 100,
    observedPrice: 100 * (1 + input.terminalReturnPercent / 100),
    rawReturnPercent: input.terminalReturnPercent,
    directionAdjustedReturnPercent: input.terminalReturnPercent,
    maximumFavorableExcursionPercent: input.favorableExcursionPercent,
    maximumAdverseExcursionPercent: input.adverseExcursionPercent,
    excursionMeasurement: input.excursionMeasurement ?? 'OBSERVED_PATH',
  });
};

describe('trade management research', () => {
  it('reports conservative and optimistic bounds when both barriers were reached', () => {
    const observations = [
      createObservation({
        alertId: 'alert-1',
        terminalReturnPercent: 0.4,
        favorableExcursionPercent: 1.2,
        adverseExcursionPercent: 0.2,
      }),
      createObservation({
        alertId: 'alert-2',
        terminalReturnPercent: -0.4,
        favorableExcursionPercent: 0.2,
        adverseExcursionPercent: 1.1,
      }),
      createObservation({
        alertId: 'alert-3',
        terminalReturnPercent: 0.2,
        favorableExcursionPercent: 0.3,
        adverseExcursionPercent: 0.3,
      }),
      createObservation({
        alertId: 'alert-4',
        terminalReturnPercent: 0.1,
        favorableExcursionPercent: 1.2,
        adverseExcursionPercent: 1.2,
      }),
      createObservation({
        alertId: 'alert-5',
        terminalReturnPercent: 0.1,
        favorableExcursionPercent: 0,
        adverseExcursionPercent: 0,
        excursionMeasurement: 'UNAVAILABLE',
      }),
      createObservation({
        alertId: 'alert-6',
        horizonMinutes: 5,
        terminalReturnPercent: 0.1,
        favorableExcursionPercent: 0.2,
        adverseExcursionPercent: 0.2,
      }),
    ];
    const report = evaluateTradeManagementPolicy({
      observations,
      policy: {
        horizonMinutes: 15,
        targetPercent: 1,
        stopPercent: 0.8,
        roundTripCostPercent: 0.2,
      },
    });

    expect(report.inputObservationCount).toBe(6);
    expect(report.ignoredOtherHorizonCount).toBe(1);
    expect(report.unavailablePathCount).toBe(1);
    expect(report.observedPathSampleSize).toBe(4);
    expect(report.targetReachedCount).toBe(1);
    expect(report.stopReachedCount).toBe(1);
    expect(report.terminalExitCount).toBe(1);
    expect(report.ambiguousBarrierOrderCount).toBe(1);
    expect(report.ambiguousBarrierOrderFraction).toBe(0.25);
    expect(report.lowerBoundMetrics.expectancyPercent).toBeCloseTo(-0.3);
    expect(report.upperBoundMetrics.expectancyPercent).toBeCloseTo(0.15);
    expect(report.lowerBoundMetrics.profitFactor).toBeCloseTo(0.4);
    expect(report.upperBoundMetrics.profitFactor).toBeCloseTo(1.6);
    expect(report.unambiguousMetrics.sampleSize).toBe(3);
    expect(report.observations[3]?.resolution).toBe(
      'AMBIGUOUS_BARRIER_ORDER',
    );
    expect(report.liveOrderExecutionAllowed).toBe(false);
  });

  it('calculates expectancy, event risk ratios, drawdown, and recovery', () => {
    const metrics = calculateStrategyReturnMetrics([1, -2, 3, -1]);

    expect(metrics.sampleSize).toBe(4);
    expect(metrics.winRate).toBe(0.5);
    expect(metrics.expectancyPercent).toBe(0.25);
    expect(metrics.profitFactor).toBeCloseTo(4 / 3);
    expect(metrics.maximumDrawdownPercent).toBe(2);
    expect(metrics.recoveryFactor).toBe(0.5);
    expect(metrics.eventSharpe).not.toBeNull();
    expect(metrics.eventSortino).not.toBeNull();
  });

  it('rejects duplicate observations for the selected horizon', () => {
    const observation = createObservation({
      alertId: 'alert-1',
      terminalReturnPercent: 0.2,
      favorableExcursionPercent: 0.3,
      adverseExcursionPercent: 0.1,
    });

    expect(() =>
      evaluateTradeManagementPolicy({
        observations: [observation, observation],
        policy: {
          horizonMinutes: 15,
          targetPercent: 1,
          stopPercent: 1,
          roundTripCostPercent: 0.2,
        },
      }),
    ).toThrow(/Duplicate trade-management observation/);
  });
});
