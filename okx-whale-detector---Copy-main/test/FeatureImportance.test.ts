import { describe, expect, it } from 'vitest';

import { calculatePermutationImportance } from '../src/features/FeatureImportance';

describe('calculatePermutationImportance', () => {
  it('ranks the predictive feature above irrelevant noise', () => {
    const observations = Array.from({ length: 20 }, (_, index) => ({
      features: {
        signal: index - 10,
        noise: index % 2,
      },
      target: (index - 10) * 2,
    }));

    const result = calculatePermutationImportance(
      observations,
      (features) => (features.signal ?? 0) * 2,
      { repetitions: 30, seed: 7 },
    );

    expect(result[0]?.featureName).toBe('signal');
    expect(result[0]?.importance).toBeGreaterThan(0);
    expect(
      result.find((feature) => feature.featureName === 'noise')?.importance,
    ).toBe(0);
  });

  it('is deterministic for a frozen seed', () => {
    const observations = [
      { features: { value: 1 }, target: 1 },
      { features: { value: 2 }, target: 2 },
      { features: { value: 3 }, target: 3 },
    ];
    const options = { repetitions: 10, seed: 123 };

    expect(
      calculatePermutationImportance(
        observations,
        (features) => features.value ?? 0,
        options,
      ),
    ).toEqual(
      calculatePermutationImportance(
        observations,
        (features) => features.value ?? 0,
        options,
      ),
    );
  });
});
