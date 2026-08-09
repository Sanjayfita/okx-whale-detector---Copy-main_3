import { describe, expect, it } from 'vitest';

import { extractAlphaFeatures } from '../src/research/alphaFeatureExtractor';
import type { AlphaResearchDatasetRow } from '../src/research/alphaFeatureTypes';
import { createAlphaResearchConfig } from '../src/research/alphaResearchConfig';
import { createAlphaPurgedWalkForwardSplit } from '../src/research/alphaWalkForward';
import { createAlphaSnapshotFixture } from './AlphaResearchFixtures';

const features = extractAlphaFeatures(
  createAlphaSnapshotFixture(),
  createAlphaResearchConfig().extraction,
).values;

const rows = Array.from({ length: 30 }, (_, index): AlphaResearchDatasetRow => {
  const detectedAt = 1_000_000 + index * 2 * 60 * 60_000;
  return Object.freeze({
    evaluationId: 'alpha-walk-forward',
    alertId: `alert-${index}`,
    instrumentId: 'BTC-USDT',
    detectedAt,
    direction: 'BULLISH',
    outcomeObservedAt: detectedAt + 15 * 60_000,
    horizonMinutes: 15,
    grossReturnPercent: 0.3,
    netReturnPercent: 0.1,
    features,
    synthetic: true,
  });
});

describe('alpha purged walk-forward splitting', () => {
  it('keeps a final holdout and enforces label purge plus event embargo', () => {
    const config = createAlphaResearchConfig({
      analysis: {
        foldCount: 3,
        holdoutFraction: 0.2,
        minimumTrainingRows: 5,
        minimumFeatureSamples: 3,
        minimumIndependentEpisodes: 2,
        minimumHoldoutSamples: 2,
        minimumHoldoutEpisodes: 2,
        purgeMs: 60 * 60_000,
        embargoMs: 30 * 60_000,
      },
    });
    const split = createAlphaPurgedWalkForwardSplit(rows, config.analysis);

    expect(split.discoveryRows).toHaveLength(24);
    expect(split.finalHoldoutRows).toHaveLength(6);
    expect(split.folds).toHaveLength(3);
    for (const fold of split.folds) {
      for (const trainingRow of fold.trainingRows) {
        expect(trainingRow.detectedAt).toBeLessThan(
          fold.testStartedAt - config.analysis.embargoMs,
        );
        expect(trainingRow.outcomeObservedAt).toBeLessThanOrEqual(
          fold.testStartedAt - config.analysis.purgeMs,
        );
      }
      expect(fold.testingRows[0].detectedAt).toBe(fold.testStartedAt);
    }
    const holdoutStart = split.finalHoldoutRows[0].detectedAt;
    for (const trainingRow of split.finalTrainingRows) {
      expect(trainingRow.detectedAt).toBeLessThan(
        holdoutStart - config.analysis.embargoMs,
      );
      expect(trainingRow.outcomeObservedAt).toBeLessThanOrEqual(
        holdoutStart - config.analysis.purgeMs,
      );
    }
  });

  it('returns no folds instead of leaking when the sample is insufficient', () => {
    const config = createAlphaResearchConfig({
      analysis: {
        foldCount: 5,
        minimumTrainingRows: 20,
        minimumHoldoutSamples: 2,
      },
    });
    const split = createAlphaPurgedWalkForwardSplit(
      rows.slice(0, 10),
      config.analysis,
    );
    expect(split.folds).toEqual([]);
  });
});
