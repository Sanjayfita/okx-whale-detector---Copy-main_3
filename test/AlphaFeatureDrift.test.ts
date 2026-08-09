import { describe, expect, it } from 'vitest';

import { calculatePopulationStabilityIndex } from '../src/research/alphaFeatureDrift';

describe('alpha feature drift', () => {
  it('distinguishes a stable distribution from a shifted one', () => {
    const stableDiscovery = Array.from(
      { length: 100 },
      (_, index) => index % 10,
    );
    const stableHoldout = Array.from({ length: 50 }, (_, index) => index % 10);
    const stable = calculatePopulationStabilityIndex({
      discoveryValues: stableDiscovery,
      holdoutValues: stableHoldout,
      binCount: 10,
      minimumSamples: 30,
    });
    const shifted = calculatePopulationStabilityIndex({
      discoveryValues: Array.from({ length: 100 }, () => 1),
      holdoutValues: Array.from({ length: 50 }, () => 2),
      binCount: 10,
      minimumSamples: 30,
    });

    expect(stable).not.toBeNull();
    expect(stable ?? 1).toBeLessThan(0.1);
    expect(shifted).not.toBeNull();
    expect(shifted ?? 0).toBeGreaterThan(0.25);
  });

  it('treats missingness as a distribution bucket and reports low power', () => {
    const missingShift = calculatePopulationStabilityIndex({
      discoveryValues: Array.from({ length: 100 }, () => 1),
      holdoutValues: [
        ...Array.from({ length: 50 }, () => 1),
        ...Array.from({ length: 50 }, () => null),
      ],
      binCount: 5,
      minimumSamples: 30,
    });
    const insufficient = calculatePopulationStabilityIndex({
      discoveryValues: [1, 2],
      holdoutValues: [1, 2],
      binCount: 5,
      minimumSamples: 3,
    });

    expect(missingShift ?? 0).toBeGreaterThan(0.25);
    expect(insufficient).toBeNull();
    expect(() =>
      calculatePopulationStabilityIndex({
        discoveryValues: [1, Number.POSITIVE_INFINITY],
        holdoutValues: [1, 2],
        binCount: 2,
        minimumSamples: 1,
      }),
    ).toThrow('finite or null');
  });
});
