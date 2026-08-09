import { describe, expect, it } from 'vitest';

import { aggregateAlertOutcomeStatistics } from '../src/research/aggregateAlertOutcomeStatistics';
import type { QualifiedAlertOutcomeBundle } from '../src/research/qualifiedAlertOutcomeBundle';

const bundle = (
  alertId: string,
  returns: readonly number[],
  evaluationId = 'evaluation-1',
): QualifiedAlertOutcomeBundle => ({
  schemaVersion: 1,
  evidence: {
    schemaVersion: 1,
    evaluationId,
    alertId,
    instrumentId: 'BTC-USDT',
    detectedAt: 1_000,
    recordedAt: 1_001,
    direction: 'BULLISH',
    signalType: 'WHALE',
    confidence: 80,
    referencePrice: 100,
    bestBid: 99,
    bestAsk: 101,
    spreadPercent: 2,
    sourceCommit: 'abc123',
    configurationFingerprint: 'config-1',
    qualified: true,
    liveOrderExecutionAllowed: false,
  },
  observations: [1, 5, 15, 30, 60].map((horizonMinutes, index) => ({
    schemaVersion: 1,
    evaluationId,
    alertId,
    instrumentId: 'BTC-USDT',
    detectedAt: 1_000,
    horizonMinutes: horizonMinutes as 1 | 5 | 15 | 30 | 60,
    observedAt: 1_000 + horizonMinutes * 60_000,
    referencePrice: 100,
    observedPrice: 100 + returns[index]!,
    rawReturnPercent: returns[index]!,
    directionAdjustedReturnPercent: returns[index]!,
    maximumFavorableExcursionPercent: Math.max(returns[index]!, 0) + 1,
    maximumAdverseExcursionPercent: Math.max(-returns[index]!, 0) + 0.5,
    complete: true,
    liveOrderExecutionAllowed: false,
  })),
  completeHorizons: [1, 5, 15, 30, 60],
  complete: true,
  liveOrderExecutionAllowed: false,
});

describe('aggregateAlertOutcomeStatistics', () => {
  it('calculates per-horizon sample counts, win rates, returns, and excursions', () => {
    const result = aggregateAlertOutcomeStatistics([
      bundle('alert-1', [1, -1, 0, 2, -2]),
      bundle('alert-2', [3, 1, 0, -2, 2]),
    ]);

    expect(result.evaluationId).toBe('evaluation-1');
    expect(result.bundleCount).toBe(2);
    expect(result.horizonStatistics).toHaveLength(5);
    expect(result.horizonStatistics[0]).toMatchObject({
      horizonMinutes: 1,
      sampleSize: 2,
      excursionSampleSize: 2,
      wins: 2,
      losses: 0,
      flats: 0,
      winRatePercent: 100,
      averageDirectionAdjustedReturnPercent: 2,
      averageMaximumFavorableExcursionPercent: 3,
      averageMaximumAdverseExcursionPercent: 0.5,
    });
    expect(result.horizonStatistics[2]).toMatchObject({
      horizonMinutes: 15,
      wins: 0,
      losses: 0,
      flats: 2,
      winRatePercent: 0,
      averageDirectionAdjustedReturnPercent: 0,
    });
    expect(result.complete).toBe(true);
    expect(result.liveOrderExecutionAllowed).toBe(false);
  });

  it('rejects an empty bundle collection', () => {
    expect(() => aggregateAlertOutcomeStatistics([])).toThrow(
      'At least one qualified alert outcome bundle is required',
    );
  });

  it('rejects bundles from different evaluations', () => {
    expect(() =>
      aggregateAlertOutcomeStatistics([
        bundle('alert-1', [1, 1, 1, 1, 1], 'evaluation-1'),
        bundle('alert-2', [1, 1, 1, 1, 1], 'evaluation-2'),
      ]),
    ).toThrow('All bundles must belong to the same evaluation');
  });
});
