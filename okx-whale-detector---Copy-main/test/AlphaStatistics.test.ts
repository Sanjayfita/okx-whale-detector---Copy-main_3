import { describe, expect, it } from 'vitest';

import { extractAlphaFeatures } from '../src/research/alphaFeatureExtractor';
import type { AlphaResearchDatasetRow } from '../src/research/alphaFeatureTypes';
import { createAlphaResearchConfig } from '../src/research/alphaResearchConfig';
import {
  alphaMean,
  alphaMutualInformation,
  alphaSpearmanCorrelation,
  alphaTrimmedMean,
  assignAlphaEpisodeIds,
  bayesianBootstrapAlphaEstimate,
  benjaminiHochbergAdjustedPValues,
  bootstrapAlphaConditionalEffect,
  bootstrapAlphaEstimate,
} from '../src/research/alphaStatistics';
import { createAlphaSnapshotFixture } from './AlphaResearchFixtures';

const features = extractAlphaFeatures(
  createAlphaSnapshotFixture(),
  createAlphaResearchConfig().extraction,
).values;

const TWO_HOURS_MS = 2 * 60 * 60_000;

const row = (
  alertId: string,
  detectedAt: number,
  netReturnPercent: number,
  instrumentId = 'BTC-USDT',
): AlphaResearchDatasetRow =>
  Object.freeze({
    evaluationId: 'alpha-statistics',
    alertId,
    instrumentId,
    detectedAt,
    direction: 'BULLISH',
    outcomeObservedAt: detectedAt + 15 * 60_000,
    horizonMinutes: 15,
    grossReturnPercent: netReturnPercent + 0.2,
    netReturnPercent,
    features,
    synthetic: true,
  });

describe('alpha statistics', () => {
  it('uses compensated arithmetic and rejects non-finite samples', () => {
    expect(alphaMean([10 ** 16, 1, 1, -(10 ** 16)])).toBe(0.5);
    expect(alphaTrimmedMean([-100, 1, 2, 3, 100], 0.2)).toBe(2);
    expect(() => alphaMean([1, Number.NaN])).toThrow('finite values');
    expect(() => alphaTrimmedMean([1], 0.5)).toThrow('trimFraction');
  });

  it('computes rank information and mutual information deterministically', () => {
    const increasing = Array.from({ length: 20 }, (_, index) => index);
    const target = increasing.map((value) => value * 2 + 1);

    expect(alphaSpearmanCorrelation(increasing, target)).toBeCloseTo(1);
    expect(alphaMutualInformation(increasing, target, 4)).toBeGreaterThan(0);
    expect(
      alphaMutualInformation(
        Array.from({ length: 20 }, () => 1),
        target,
        4,
      ),
    ).toBe(0);
  });

  it('uses dependency-aware alert episodes for reproducible bootstrap bounds', () => {
    const rows = [
      row('a', 1_000_000, 0.2),
      row('b', 1_010_000, 0.4),
      row('c', 1_000_000 + 2 * 60 * 60_000, -0.1),
    ];
    const episodeIds = assignAlphaEpisodeIds(rows, 60 * 60_000);
    const first = bootstrapAlphaEstimate({
      rows,
      episodeIds,
      iterations: 200,
      confidenceLevel: 0.95,
      seed: 123,
    });
    const second = bootstrapAlphaEstimate({
      rows,
      episodeIds,
      iterations: 200,
      confidenceLevel: 0.95,
      seed: 123,
    });

    expect(first).toEqual(second);
    expect(first.sampleSize).toBe(3);
    expect(first.independentEpisodeCount).toBe(2);
    expect(first.meanPercent).toBeCloseTo(1 / 6);
    expect(first.lowerConfidencePercent).not.toBeNull();
    expect(first.upperConfidencePercent).not.toBeNull();
    expect(first.medianPercent).toBeCloseTo(0.2);
    expect(first.trimmedMeanPercent).toBeCloseTo(1 / 6);
    expect(first.clusterRobustStandardErrorPercent).not.toBeNull();
    expect(first.minimumDetectableEffectPercent).not.toBeNull();
  });

  it('uses a null-centered cluster bootstrap for one-sided inference', () => {
    const rows = Array.from({ length: 20 }, (_, index) =>
      row(`positive-${index}`, index * 2 * 60 * 60_000, 0.25),
    );
    const episodeIds = new Map(
      rows.map((item) => [item.alertId, item.alertId]),
    );
    const estimate = bootstrapAlphaEstimate({
      rows,
      episodeIds,
      iterations: 199,
      confidenceLevel: 0.95,
      targetPower: 0.8,
      trimFraction: 0.1,
      seed: 9,
    });

    expect(estimate.oneSidedPValue).toBe(1 / 200);
    expect(estimate.probabilityPositive).toBe(1);
    expect(estimate.lowerConfidencePercent).toBeCloseTo(0.25);
  });

  it('tests conditional uplift against the available OOS baseline', () => {
    const rows = Array.from({ length: 100 }, (_, index) =>
      row(`effect-${index}`, index * 2 * 60 * 60_000, index < 25 ? 0.5 : -0.1),
    );
    const selectedAlertIds = new Set(
      rows.slice(0, 25).map((item) => item.alertId),
    );
    const episodeIds = new Map(
      rows.map((item) => [item.alertId, item.alertId]),
    );
    const effect = bootstrapAlphaConditionalEffect({
      availableRows: rows,
      selectedAlertIds,
      episodeIds,
      iterations: 500,
      confidenceLevel: 0.95,
      seed: 55,
    });

    expect(effect.effectPercent).toBeCloseTo(0.45);
    expect(effect.lowerConfidencePercent).toBeGreaterThan(0);
    expect(effect.selectedSampleSize).toBe(25);
    expect(effect.selectedIndependentEpisodeCount).toBe(25);
    expect(effect.oneSidedPValue).toBeLessThan(0.05);
    expect(() =>
      bootstrapAlphaConditionalEffect({
        availableRows: rows,
        selectedAlertIds: new Set(['not-available']),
        episodeIds,
        iterations: 100,
        confidenceLevel: 0.95,
        seed: 1,
      }),
    ).toThrow('outside the available sample');
  });

  it('provides a reproducible episode-weighted Bayesian sensitivity estimate', () => {
    const rows = Array.from({ length: 20 }, (_, index) =>
      row(`bayesian-${index}`, index * TWO_HOURS_MS, 0.2),
    );
    const episodeIds = new Map(
      rows.map((item) => [item.alertId, item.alertId]),
    );
    const input = {
      rows,
      episodeIds,
      iterations: 200,
      credibleLevel: 0.95,
      seed: 99,
    } as const;

    const first = bayesianBootstrapAlphaEstimate(input);
    const second = bayesianBootstrapAlphaEstimate(input);

    expect(second).toEqual(first);
    expect(first.posteriorMeanPercent).toBeCloseTo(0.2);
    expect(first.lowerCrediblePercent).toBeCloseTo(0.2);
    expect(first.posteriorProbabilityPositive).toBe(1);
  });

  it('applies monotonic Benjamini-Hochberg adjusted p-values', () => {
    const adjusted = benjaminiHochbergAdjustedPValues([
      { key: 'a', pValue: 0.001 },
      { key: 'b', pValue: 0.02 },
      { key: 'c', pValue: 0.8 },
    ]);

    expect(adjusted.get('a')).toBeCloseTo(0.003);
    expect(adjusted.get('b')).toBeCloseTo(0.03);
    expect(adjusted.get('c')).toBeCloseTo(0.8);
    expect(() =>
      benjaminiHochbergAdjustedPValues([
        { key: 'duplicate', pValue: 0.1 },
        { key: 'duplicate', pValue: 0.2 },
      ]),
    ).toThrow('unique');
    expect(() =>
      benjaminiHochbergAdjustedPValues([
        { key: 'invalid', pValue: Number.NaN },
      ]),
    ).toThrow('finite');
  });
});
