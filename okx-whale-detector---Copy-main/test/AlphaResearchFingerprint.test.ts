import { describe, expect, it } from 'vitest';

import { requireArrayElement } from '../src/core/arrayAccess';
import { extractAlphaFeatures } from '../src/research/alphaFeatureExtractor';
import { analyzeAlphaResearchDataset } from '../src/research/alphaResearchAnalysis';
import { createAlphaResearchConfig } from '../src/research/alphaResearchConfig';
import { createAlphaResearchDatasetFingerprint } from '../src/research/alphaResearchFingerprint';
import type { AlphaResearchDataset } from '../src/research/alphaFeatureTypes';
import { createAlphaSnapshotFixture } from './AlphaResearchFixtures';

const createDataset = (): AlphaResearchDataset => {
  const config = createAlphaResearchConfig();
  const features = extractAlphaFeatures(
    createAlphaSnapshotFixture(),
    config.extraction,
  ).values;
  const rows = [0, 1].map((index) => ({
    evaluationId: 'fingerprint-evaluation',
    alertId: `alert-${index}`,
    instrumentId: 'BTC-USDT',
    detectedAt: 1_700_000_000_000 + index * 60_000,
    direction: 'BULLISH' as const,
    outcomeObservedAt: 1_700_000_900_000 + index * 60_000,
    horizonMinutes: 15 as const,
    grossReturnPercent: 0.3 + index,
    netReturnPercent: 0.1 + index,
    features,
    synthetic: true,
  }));
  return Object.freeze({
    evaluationId: 'fingerprint-evaluation',
    targetHorizonMinutes: 15,
    roundTripCostPercent: 0.2,
    rows: Object.freeze(rows),
    inputAlertCount: 2,
    inputSnapshotCount: 2,
    inputOutcomeCount: 2,
    unmatchedSnapshots: 0,
    missingSnapshots: 0,
    unmatchedOutcomes: 0,
    ignoredOtherHorizonOutcomes: 0,
    synthetic: true,
    liveOrderExecutionAllowed: false,
  });
};

describe('alpha research dataset fingerprint', () => {
  it('is stable across source ordering but changes for a research value', () => {
    const dataset = createDataset();
    const reordered: AlphaResearchDataset = Object.freeze({
      ...dataset,
      rows: Object.freeze([...dataset.rows].reverse()),
    });
    const changed: AlphaResearchDataset = Object.freeze({
      ...dataset,
      rows: Object.freeze([
        {
          ...requireArrayElement(dataset.rows, 0, 'first dataset row'),
          netReturnPercent: 0.100_001,
        },
        requireArrayElement(dataset.rows, 1, 'second dataset row'),
      ]),
    });

    expect(createAlphaResearchDatasetFingerprint(reordered)).toBe(
      createAlphaResearchDatasetFingerprint(dataset),
    );
    expect(createAlphaResearchDatasetFingerprint(changed)).not.toBe(
      createAlphaResearchDatasetFingerprint(dataset),
    );
  });

  it('embeds the exact analyzed-dataset identity in every report', () => {
    const dataset = createDataset();
    const config = createAlphaResearchConfig({
      analysis: { bootstrapIterations: 100 },
    });
    const report = analyzeAlphaResearchDataset({ dataset, config });

    expect(report.datasetFingerprint).toBe(
      createAlphaResearchDatasetFingerprint(dataset),
    );
  });
});
