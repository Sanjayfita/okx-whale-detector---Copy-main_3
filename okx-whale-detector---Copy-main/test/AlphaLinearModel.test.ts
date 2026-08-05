import { describe, expect, it } from 'vitest';

import { requireArrayElement } from '../src/core/arrayAccess';
import { extractAlphaFeatures } from '../src/research/alphaFeatureExtractor';
import type { AlphaResearchDatasetRow } from '../src/research/alphaFeatureTypes';
import {
  createAlphaPartialDependence,
  fitAlphaRidgeModel,
} from '../src/research/alphaLinearModel';
import { createAlphaResearchConfig } from '../src/research/alphaResearchConfig';
import { createAlphaSnapshotFixture } from './AlphaResearchFixtures';

const baseFeatures = extractAlphaFeatures(
  createAlphaSnapshotFixture(),
  createAlphaResearchConfig().extraction,
).values;

const createRows = (): readonly AlphaResearchDatasetRow[] =>
  Object.freeze(
    Array.from({ length: 20 }, (_, index) => {
      const first = index / 20;
      const second = (index % 3) - 1;
      const netReturnPercent = first * 0.4 - second * 0.1;
      return Object.freeze({
        evaluationId: 'linear-model-fixture',
        alertId: `alert-${index}`,
        instrumentId: 'BTC-USDT',
        detectedAt: 1_700_000_000_000 + index * 60_000,
        direction: 'BULLISH' as const,
        outcomeObservedAt: 1_700_000_900_000 + index * 60_000,
        horizonMinutes: 15 as const,
        grossReturnPercent: netReturnPercent + 0.2,
        netReturnPercent,
        features: Object.freeze({
          ...baseFeatures,
          ema_alignment_directional: first,
          volume_zscore: second,
        }),
        synthetic: true,
      });
    }),
  );

describe('alpha ridge model', () => {
  it('keeps regularization strength invariant when rows are duplicated', () => {
    const rows = createRows();
    const duplicated = Object.freeze(
      [...rows, ...rows].map((row, index) => ({
        ...row,
        alertId: `duplicated-${index}`,
      })),
    );
    const features = ['ema_alignment_directional', 'volume_zscore'] as const;
    const original = fitAlphaRidgeModel({
      rows,
      features,
      ridgeLambda: 1,
    });
    const repeated = fitAlphaRidgeModel({
      rows: duplicated,
      features,
      ridgeLambda: 1,
    });

    expect(repeated.targetMean).toBeCloseTo(original.targetMean, 12);
    expect(repeated.coefficients).toHaveLength(original.coefficients.length);
    repeated.coefficients.forEach((coefficient, index) => {
      expect(coefficient).toBeCloseTo(
        requireArrayElement(
          original.coefficients,
          index,
          'original ridge coefficient',
        ),
        12,
      );
    });
  });

  it('builds a training-only partial-dependence grid', () => {
    const rows = createRows();
    const features = ['ema_alignment_directional', 'volume_zscore'] as const;
    const model = fitAlphaRidgeModel({ rows, features, ridgeLambda: 1 });
    const dependence = createAlphaPartialDependence({
      model,
      referenceRows: rows,
      feature: 'ema_alignment_directional',
      gridPoints: 5,
      lowerQuantile: 0.05,
      upperQuantile: 0.95,
    });

    expect(dependence).toHaveLength(5);
    expect(dependence[0]?.featureValue).toBeLessThan(
      dependence.at(-1)?.featureValue ?? Number.NEGATIVE_INFINITY,
    );
    expect(dependence[0]?.meanPredictedNetReturnPercent).toBeLessThan(
      dependence.at(-1)?.meanPredictedNetReturnPercent ??
        Number.NEGATIVE_INFINITY,
    );
  });
});
