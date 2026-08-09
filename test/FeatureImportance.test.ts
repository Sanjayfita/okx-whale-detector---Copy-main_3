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
    expect(result[0]?.permutationScope).toBe('GLOBAL');
    expect(
      result.find((feature) => feature.featureName === 'noise')?.importance,
    ).toBe(0);
  });

  it('permutes within frozen temporal or regime blocks', () => {
    const observations = [
      { blockId: 'trend', features: { signal: 1 }, target: 1 },
      { blockId: 'trend', features: { signal: 2 }, target: 2 },
      { blockId: 'range', features: { signal: 100 }, target: 100 },
      { blockId: 'range', features: { signal: 101 }, target: 101 },
    ];
    const result = calculatePermutationImportance(
      observations,
      (features) => features.signal ?? 0,
      {
        repetitions: 20,
        seed: 17,
        permutationScope: 'WITHIN_BLOCK',
      },
    );

    expect(result[0]).toMatchObject({
      featureName: 'signal',
      permutationScope: 'WITHIN_BLOCK',
      blockCount: 2,
      permutableBlockCount: 2,
    });
    expect(result[0]?.importance).toBeGreaterThan(0);
    expect(result[0]?.permutedLoss).toBeLessThan(10);
  });

  it('fails closed when block-aware evidence has no usable blocks', () => {
    expect(() =>
      calculatePermutationImportance(
        [
          { blockId: 'one', features: { value: 1 }, target: 1 },
          { blockId: 'two', features: { value: 2 }, target: 2 },
        ],
        (features) => features.value ?? 0,
        { permutationScope: 'WITHIN_BLOCK' },
      ),
    ).toThrow('permutable block');
  });

  it('is deterministic for a frozen seed and blocks', () => {
    const observations = [
      { blockId: 'a', features: { value: 1 }, target: 1 },
      { blockId: 'a', features: { value: 2 }, target: 2 },
      { blockId: 'b', features: { value: 3 }, target: 3 },
      { blockId: 'b', features: { value: 4 }, target: 4 },
    ];
    const options = {
      repetitions: 10,
      seed: 123,
      permutationScope: 'WITHIN_BLOCK' as const,
    };

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
