import { describe, expect, it } from 'vitest';

import {
  analyzeAlphaConfidenceResearch,
  DEFAULT_ALPHA_CONFIDENCE_MODEL_CONFIG,
} from '../src/research/alphaConfidenceResearch';
import { createMissingAlphaFeatureValues } from '../src/research/alphaFeatureExtractor';
import {
  DEFAULT_ALPHA_FEATURE_EXTRACTION_CONFIG,
  DEFAULT_ALPHA_RESEARCH_ANALYSIS_CONFIG,
} from '../src/research/alphaResearchConfig';
import type {
  AlphaResearchConfig,
  AlphaResearchDataset,
  AlphaResearchDatasetRow,
} from '../src/research/alphaFeatureTypes';

const createConfig = (): AlphaResearchConfig =>
  Object.freeze({
    extraction: Object.freeze({
      ...DEFAULT_ALPHA_FEATURE_EXTRACTION_CONFIG,
      enabledFeatures: Object.freeze(['execution_ratio'] as const),
    }),
    analysis: Object.freeze({
      ...DEFAULT_ALPHA_RESEARCH_ANALYSIS_CONFIG,
      foldCount: 3,
      holdoutFraction: 0.2,
      purgeMs: 0,
      embargoMs: 0,
      episodeWindowMs: 1,
      minimumTrainingRows: 30,
      minimumFeatureSamples: 10,
      minimumIndependentEpisodes: 10,
      minimumHoldoutSamples: 20,
      minimumHoldoutEpisodes: 10,
      minimumCalibrationSamples: 20,
      bootstrapIterations: 100,
      bayesianBootstrapIterations: 100,
      monteCarloIterations: 100,
      permutationRepeats: 2,
    }),
  });

const createRows = (synthetic: boolean): readonly AlphaResearchDatasetRow[] =>
  Object.freeze(
    Array.from({ length: 180 }, (_, index) => {
      const executionRatio = (index % 10) / 9;
      const successful = index % 10 >= 5;
      const detectedAt = 1_800_000_000_000 + index * 30 * 60_000;
      return Object.freeze({
        evaluationId: 'confidence-research-test',
        alertId: `alert-${index}`,
        instrumentId: index % 2 === 0 ? 'BTC-USDT' : 'ETH-USDT',
        detectedAt,
        direction: index % 2 === 0 ? ('BULLISH' as const) : ('BEARISH' as const),
        outcomeObservedAt: detectedAt + 15 * 60_000,
        horizonMinutes: 15 as const,
        grossReturnPercent: successful ? 0.6 : -0.4,
        netReturnPercent: successful ? 0.4 : -0.6,
        features: Object.freeze({
          ...createMissingAlphaFeatureValues(),
          execution_ratio: executionRatio,
        }),
        synthetic,
      });
    }),
  );

const createDataset = (
  synthetic = false,
  missingSnapshots = 0,
): AlphaResearchDataset => {
  const rows = createRows(synthetic);
  return Object.freeze({
    evaluationId: 'confidence-research-test',
    targetHorizonMinutes: 15,
    roundTripCostPercent: 0.2,
    rows,
    inputAlertCount: rows.length + missingSnapshots,
    inputSnapshotCount: rows.length,
    inputOutcomeCount: rows.length,
    unmatchedSnapshots: 0,
    missingSnapshots,
    unmatchedOutcomes: 0,
    ignoredOtherHorizonOutcomes: 0,
    synthetic,
    liveOrderExecutionAllowed: false,
  });
};

describe('alpha confidence research', () => {
  it('uses purged walk-forward predictions and prior-fold-only calibration', () => {
    const report = analyzeAlphaConfidenceResearch({
      dataset: createDataset(),
      alphaConfig: createConfig(),
      confidenceConfig: Object.freeze({
        ...DEFAULT_ALPHA_CONFIDENCE_MODEL_CONFIG,
        minimumCalibrationSamples: 20,
        calibrationBins: 5,
        iterations: 1_000,
        plattIterations: 1_000,
      }),
    });

    expect(report.status).toBe('COMPLETE');
    expect(report.foldSummaries).toHaveLength(3);
    expect(report.foldSummaries[0]?.priorCalibrationSampleSize).toBe(0);
    expect(report.foldSummaries[0]?.calibratedSampleSize).toBe(0);
    expect(report.foldSummaries[1]?.priorCalibrationSampleSize).toBeGreaterThan(
      0,
    );
    expect(report.discoveryUncalibrated.sampleSize).toBeGreaterThan(0);
    expect(report.discoverySequentiallyCalibrated.sampleSize).toBeGreaterThan(0);
    expect(report.discoveryUncalibrated.rocAuc).toBeGreaterThan(0.95);
    expect(report.finalHoldoutUncalibrated.sampleSize).toBe(
      report.finalHoldoutRows,
    );
    expect(report.finalHoldoutCalibrated.sampleSize).toBe(
      report.finalHoldoutRows,
    );
    expect(report.finalHoldoutCalibrated.rocAuc).toBeGreaterThan(0.95);
    expect(report.productionEnabled).toBe(false);
    expect(report.liveOrderExecutionAllowed).toBe(false);
  });

  it('marks synthetic probability output as non-empirical', () => {
    const report = analyzeAlphaConfidenceResearch({
      dataset: createDataset(true),
      alphaConfig: createConfig(),
      confidenceConfig: Object.freeze({
        ...DEFAULT_ALPHA_CONFIDENCE_MODEL_CONFIG,
        minimumCalibrationSamples: 20,
        iterations: 500,
        plattIterations: 500,
      }),
    });

    expect(report.status).toBe('NO_EMPIRICAL_DATA');
    expect(report.discoveryUncalibrated.sampleSize).toBeGreaterThan(0);
    expect(report.productionEnabled).toBe(false);
  });

  it('fails closed when the evidence population is incomplete', () => {
    const report = analyzeAlphaConfidenceResearch({
      dataset: createDataset(false, 1),
      alphaConfig: createConfig(),
    });

    expect(report.status).toBe('INCOMPLETE_DATA');
    expect(report.discoveryUncalibrated.sampleSize).toBe(0);
    expect(report.finalHoldoutCalibrated.sampleSize).toBe(0);
  });
});
