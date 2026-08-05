import { describe, expect, it } from 'vitest';

import { extractAlphaFeatures } from '../src/research/alphaFeatureExtractor';
import type {
  AlphaResearchDataset,
  AlphaResearchDatasetRow,
} from '../src/research/alphaFeatureTypes';
import { analyzeAlphaResearchDataset } from '../src/research/alphaResearchAnalysis';
import { createAlphaResearchConfig } from '../src/research/alphaResearchConfig';
import { createAlphaSnapshotFixture } from './AlphaResearchFixtures';

const enabledFeatures = [
  'ema_alignment_directional',
  'volume_zscore',
  'session_asia',
] as const;

const config = createAlphaResearchConfig({
  extraction: { enabledFeatures },
  analysis: {
    foldCount: 4,
    holdoutFraction: 0.2,
    purgeMs: 0,
    embargoMs: 0,
    episodeWindowMs: 1,
    minimumTrainingRows: 50,
    minimumFeatureSamples: 20,
    minimumIndependentEpisodes: 20,
    minimumInstruments: 2,
    minimumInstrumentSamples: 5,
    minimumPositiveInstrumentFraction: 1,
    minimumHoldoutSamples: 10,
    minimumHoldoutEpisodes: 10,
    bootstrapIterations: 100,
    bayesianBootstrapIterations: 100,
    monteCarloIterations: 100,
    permutationRepeats: 2,
    maximumInteractionFeatures: 3,
    randomSeed: 17,
  },
});

const baseFeatures = extractAlphaFeatures(
  createAlphaSnapshotFixture(),
  createAlphaResearchConfig().extraction,
).values;

const createDataset = (
  input: {
    readonly count?: number;
    readonly synthetic?: boolean;
    readonly reverseHoldout?: boolean;
  } = {},
): AlphaResearchDataset => {
  const count = input.count ?? 260;
  const holdoutStart = Math.floor(
    count * (1 - config.analysis.holdoutFraction),
  );
  const rows = Array.from(
    { length: count },
    (_, index): AlphaResearchDatasetRow => {
      const detectedAt = 1_700_000_000_000 + index * 2 * 60 * 60_000;
      const predictive = (index % 20) / 19;
      const selected = predictive >= 0.75;
      const reverse = input.reverseHoldout === true && index >= holdoutStart;
      const netReturnPercent = selected ? (reverse ? -0.5 : 0.5) : -0.25;
      return Object.freeze({
        evaluationId: 'alpha-analysis-fixture',
        alertId: `alpha-analysis-${index}`,
        instrumentId: index % 2 === 0 ? 'BTC-USDT' : 'ETH-USDT',
        detectedAt,
        direction: index % 3 === 0 ? 'BEARISH' : 'BULLISH',
        outcomeObservedAt: detectedAt + 15 * 60_000,
        horizonMinutes: 15,
        grossReturnPercent: netReturnPercent + 0.2,
        netReturnPercent,
        features: Object.freeze({
          ...baseFeatures,
          ema_alignment_directional: predictive,
          volume_zscore: ((index * 37) % 101) / 100,
          session_asia: index % 2,
        }),
        synthetic: input.synthetic ?? false,
      });
    },
  );
  return Object.freeze({
    evaluationId: 'alpha-analysis-fixture',
    targetHorizonMinutes: 15,
    roundTripCostPercent: 0.2,
    rows: Object.freeze(rows),
    inputAlertCount: count,
    inputSnapshotCount: count,
    inputOutcomeCount: count,
    unmatchedSnapshots: 0,
    missingSnapshots: 0,
    unmatchedOutcomes: 0,
    ignoredOtherHorizonOutcomes: 0,
    synthetic: input.synthetic ?? false,
    liveOrderExecutionAllowed: false,
  });
};

describe('alpha research analysis', () => {
  it('ranks a stable predictive confirmation using OOS folds and a final holdout', () => {
    const report = analyzeAlphaResearchDataset({
      dataset: createDataset(),
      config,
    });
    const predictive = report.featureRanking.find(
      (entry) => entry.feature === 'ema_alignment_directional',
    );

    expect(report.status).toBe('COMPLETE');
    expect(report.folds).toHaveLength(4);
    expect(report.featureRanking).toHaveLength(3);
    expect(predictive?.rank).toBe(1);
    expect(predictive?.conclusion).toBe('IMPROVES_EXPECTANCY');
    expect(predictive?.conditionalEstimate.meanPercent).toBeGreaterThan(0.3);
    expect(
      predictive?.conditionalEstimate.lowerConfidencePercent,
    ).toBeGreaterThan(0);
    expect(predictive?.positiveFoldFraction).toBe(1);
    expect(predictive?.orientationStability).toBe(1);
    expect(predictive?.instrumentPerformance).toHaveLength(2);
    expect(predictive?.positiveInstrumentFraction).toBe(1);
    expect(predictive?.directionPerformance).toHaveLength(2);
    expect(predictive?.holdoutPositiveInstrumentFraction).toBe(1);
    expect(predictive?.holdoutEstimate.meanPercent).toBeGreaterThan(0.3);
    expect(predictive?.partialDependence).toHaveLength(5);
    expect(predictive?.statisticallyEligible).toBe(true);
    expect(predictive?.productionEnabled).toBe(false);
    expect(report.productionFeaturesEnabled).toEqual([]);
    expect(report.interactions.length).toBeGreaterThan(0);
    expect(report.featureDrift).toHaveLength(3);
    expect(report.discoveryMonteCarlo.iterations).toBe(100);
    expect(report.discoveryBayesianBootstrap.iterations).toBe(100);
    expect(report.finalHoldoutBayesianBootstrap.sampleSize).toBeGreaterThan(0);
    expect(report.finalHoldoutMonteCarlo.sampleSize).toBeGreaterThan(0);
    expect(report.discoveryModelCalibration.sufficientSamples).toBe(true);
    expect(report.finalHoldoutModelCalibration.sufficientSamples).toBe(true);
    expect(
      report.featureDrift.find(
        (entry) => entry.feature === 'ema_alignment_directional',
      )?.classification,
    ).toBe('STABLE');
    expect(report.liveOrderExecutionAllowed).toBe(false);
  });

  it('does not let reversed final-holdout outcomes influence discovery ranking', () => {
    const stable = analyzeAlphaResearchDataset({
      dataset: createDataset(),
      config,
    });
    const reversed = analyzeAlphaResearchDataset({
      dataset: createDataset({ reverseHoldout: true }),
      config,
    });
    const stableFeature = stable.featureRanking.find(
      (entry) => entry.feature === 'ema_alignment_directional',
    );
    const reversedFeature = reversed.featureRanking.find(
      (entry) => entry.feature === 'ema_alignment_directional',
    );

    expect(reversed.featureRanking.map((entry) => entry.feature)).toEqual(
      stable.featureRanking.map((entry) => entry.feature),
    );
    expect(reversedFeature?.compositeScore).toBe(stableFeature?.compositeScore);
    expect(reversedFeature?.conditionalEstimate).toEqual(
      stableFeature?.conditionalEstimate,
    );
    expect(reversedFeature?.holdoutEstimate.meanPercent).toBeLessThan(0);
    expect(reversedFeature?.statisticallyEligible).toBe(false);
  });

  it('labels synthetic results as non-empirical and never promotes them', () => {
    const report = analyzeAlphaResearchDataset({
      dataset: createDataset({ synthetic: true }),
      config,
    });

    expect(report.status).toBe('NO_EMPIRICAL_DATA');
    expect(report.synthetic).toBe(true);
    expect(
      report.featureRanking.every(
        (entry) =>
          entry.conclusion === 'INCONCLUSIVE' &&
          !entry.statisticallyEligible &&
          !entry.productionEnabled,
      ),
    ).toBe(true);
    expect(report.notes.join(' ')).toContain('Synthetic');
  });

  it('returns an explicit inconclusive ranking for insufficient samples', () => {
    const report = analyzeAlphaResearchDataset({
      dataset: createDataset({ count: 20 }),
      config,
    });

    expect(report.status).toBe('INSUFFICIENT_DATA');
    expect(report.featureRanking).toHaveLength(3);
    expect(
      report.featureRanking.every(
        (entry) => entry.conclusion === 'INCONCLUSIVE',
      ),
    ).toBe(true);
    expect(report.productionFeaturesEnabled).toEqual([]);
  });

  it('blocks feature ranking when the authoritative alert population is incomplete', () => {
    const dataset = createDataset();
    const report = analyzeAlphaResearchDataset({
      dataset: {
        ...dataset,
        inputAlertCount: dataset.inputAlertCount + 1,
        missingSnapshots: 1,
      },
      config,
    });

    expect(report.status).toBe('INCOMPLETE_DATA');
    expect(report.missingSnapshots).toBe(1);
    expect(
      report.featureRanking.every(
        (entry) => entry.conclusion === 'INCONCLUSIVE',
      ),
    ).toBe(true);
    expect(report.productionFeaturesEnabled).toEqual([]);
  });
});
