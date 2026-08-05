import { describe, expect, it } from 'vitest';

import { createMissingAlphaFeatureValues } from '../src/research/alphaFeatureExtractor';
import { ALPHA_FEATURE_NAMES } from '../src/research/alphaFeatureTypes';
import { createAlphaResearchConfig } from '../src/research/alphaResearchConfig';
import { createAlphaResearchConfigurationFingerprint } from '../src/research/alphaResearchFingerprint';

describe('alpha research configuration', () => {
  it('exposes all 50 candidates and produces a deterministic fingerprint', () => {
    const first = createAlphaResearchConfig();
    const second = createAlphaResearchConfig();

    expect(first.extraction.enabledFeatures).toEqual(ALPHA_FEATURE_NAMES);
    expect(Object.keys(createMissingAlphaFeatureValues())).toHaveLength(50);
    expect(createAlphaResearchConfigurationFingerprint(first)).toBe(
      createAlphaResearchConfigurationFingerprint(second),
    );
    expect(
      createAlphaResearchConfigurationFingerprint(
        createAlphaResearchConfig({ analysis: { roundTripCostPercent: 0.3 } }),
      ),
    ).not.toBe(createAlphaResearchConfigurationFingerprint(first));
  });

  it('rejects invalid feature, validation, and ranking settings', () => {
    expect(() =>
      createAlphaResearchConfig({
        extraction: {
          enabledFeatures: ['adx', 'adx'],
        },
      }),
    ).toThrow('duplicate');
    expect(() =>
      createAlphaResearchConfig({ analysis: { foldCount: 1 } }),
    ).toThrow('at least 2');
    expect(() =>
      createAlphaResearchConfig({ analysis: { statisticalPower: 0.5 } }),
    ).toThrow('statisticalPower');
    expect(() =>
      createAlphaResearchConfig({ analysis: { monteCarloIterations: 99 } }),
    ).toThrow('monteCarloIterations');
    expect(() =>
      createAlphaResearchConfig({
        analysis: { bayesianBootstrapIterations: 99 },
      }),
    ).toThrow('bayesianBootstrapIterations');
    expect(() =>
      createAlphaResearchConfig({ analysis: { trimmedMeanFraction: 0.5 } }),
    ).toThrow('trimmedMeanFraction');
    expect(() =>
      createAlphaResearchConfig({
        analysis: { moderateDriftPsi: 0.3, materialDriftPsi: 0.2 },
      }),
    ).toThrow('materialDriftPsi');
    expect(() =>
      createAlphaResearchConfig({
        analysis: { partialDependenceGridPoints: 1 },
      }),
    ).toThrow('partialDependenceGridPoints');
    expect(() =>
      createAlphaResearchConfig({ analysis: { calibrationBins: 1 } }),
    ).toThrow('calibrationBins');
    expect(() =>
      createAlphaResearchConfig({ analysis: { randomSeed: 0x1_0000_0000 } }),
    ).toThrow('unsigned 32-bit');
    expect(() =>
      createAlphaResearchConfig({
        analysis: {
          rankingWeights: {
            informationCoefficient: 0.9,
          },
        },
      }),
    ).toThrow('total exactly 1');
  });
});
