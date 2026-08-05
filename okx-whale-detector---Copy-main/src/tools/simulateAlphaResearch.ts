import assert from 'node:assert/strict';

import { createMissingAlphaFeatureValues } from '../research/alphaFeatureExtractor';
import type {
  AlphaResearchDataset,
  AlphaResearchDatasetRow,
} from '../research/alphaFeatureTypes';
import { analyzeAlphaResearchDataset } from '../research/alphaResearchAnalysis';
import { createAlphaResearchConfig } from '../research/alphaResearchConfig';

export const runAlphaResearchSimulation = () => {
  const config = createAlphaResearchConfig({
    analysis: {
      foldCount: 4,
      holdoutFraction: 0.2,
      purgeMs: 0,
      embargoMs: 0,
      episodeWindowMs: 1,
      minimumTrainingRows: 50,
      minimumFeatureSamples: 20,
      minimumIndependentEpisodes: 20,
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
  const count = 260;
  const rows = Array.from(
    { length: count },
    (_, index): AlphaResearchDatasetRow => {
      const detectedAt = 1_700_000_000_000 + index * 2 * 60 * 60_000;
      const predictive = (index % 20) / 19;
      const netReturnPercent = predictive >= 0.75 ? 0.5 : -0.25;
      return Object.freeze({
        evaluationId: 'synthetic-alpha-simulation',
        alertId: `synthetic-alpha-${index}`,
        instrumentId: index % 2 === 0 ? 'BTC-USDT' : 'ETH-USDT',
        detectedAt,
        direction: index % 3 === 0 ? 'BEARISH' : 'BULLISH',
        outcomeObservedAt: detectedAt + 15 * 60_000,
        horizonMinutes: 15,
        grossReturnPercent: netReturnPercent + 0.2,
        netReturnPercent,
        features: Object.freeze({
          ...createMissingAlphaFeatureValues(),
          ema_alignment_directional: predictive,
          volume_zscore: ((index * 37) % 101) / 100,
          session_asia: index % 2,
        }),
        synthetic: true,
      });
    },
  );
  const dataset: AlphaResearchDataset = Object.freeze({
    evaluationId: 'synthetic-alpha-simulation',
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
    synthetic: true,
    liveOrderExecutionAllowed: false,
  });
  const report = analyzeAlphaResearchDataset({ dataset, config });
  assert.equal(report.status, 'NO_EMPIRICAL_DATA');
  assert.equal(report.productionFeaturesEnabled.length, 0);
  assert.equal(report.featureRanking.length, 50);
  assert.ok(
    report.featureRanking.every(
      (feature) => feature.conclusion === 'INCONCLUSIVE',
    ),
  );
  assert.equal(report.featureRanking[0]?.feature, 'ema_alignment_directional');
  assert.equal(report.featureRanking[0]?.productionEnabled, false);
  return report;
};

if (require.main === module) {
  try {
    const report = runAlphaResearchSimulation();
    console.log('SYNTHETIC WHALE-ALPHA PIPELINE SIMULATION');
    console.log(`Status: ${report.status}`);
    console.log(`Rows: ${report.totalRows}`);
    console.log(`Walk-forward folds: ${report.folds.length}`);
    console.log(`Ranked research features: ${report.featureRanking.length}`);
    console.log(`Production features enabled: 0`);
    console.log(
      'Synthetic fixture verified plumbing only; it is not evidence of profitability.',
    );
  } catch (error: unknown) {
    console.error(
      `Alpha simulation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
