import { describe, expect, it } from 'vitest';

import { analyzeAlphaRegressionCalibration } from '../src/research/alphaCalibration';

describe('alpha regression calibration', () => {
  it('reports slope, intercept, errors, and equal-frequency bins', () => {
    const pairs = Array.from({ length: 20 }, (_, index) => ({
      prediction: index / 10,
      observation: 1 + (2 * index) / 10,
    }));
    const result = analyzeAlphaRegressionCalibration({
      pairs,
      binCount: 5,
      minimumSamples: 10,
    });

    expect(result.sufficientSamples).toBe(true);
    expect(result.calibrationSlope).toBeCloseTo(2);
    expect(result.calibrationInterceptPercent).toBeCloseTo(1);
    expect(result.predictionObservedCorrelation).toBeCloseTo(1);
    expect(result.bins).toHaveLength(5);
    expect(result.bins.every((bin) => bin.sampleSize === 4)).toBe(true);
  });

  it('does not imply calibration when the sample requirement is unmet', () => {
    const result = analyzeAlphaRegressionCalibration({
      pairs: [{ prediction: 0.1, observation: -0.2 }],
      binCount: 5,
      minimumSamples: 30,
    });

    expect(result.sampleSize).toBe(1);
    expect(result.sufficientSamples).toBe(false);
    expect(result.calibrationSlope).toBeNull();
  });
});
