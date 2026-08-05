import { describe, expect, it } from 'vitest';

import {
  adjustHolmBonferroni,
  evaluatePairedSignificance,
} from '../src/research/StatisticalSignificance';

describe('evaluatePairedSignificance', () => {
  it('finds stable positive paired improvement deterministically', () => {
    const outcomes = Array.from({ length: 80 }, (_, index) => ({
      pairId: `episode-${index}`,
      baselineValue: index % 4 === 0 ? -2 : 1,
      candidateValue: (index % 4 === 0 ? -2 : 1) + 1,
    }));
    const first = evaluatePairedSignificance({
      outcomes,
      policy: {
        bootstrapIterations: 2_000,
        randomizationIterations: 2_000,
        seed: 7,
      },
    });
    const second = evaluatePairedSignificance({
      outcomes,
      policy: {
        bootstrapIterations: 2_000,
        randomizationIterations: 2_000,
        seed: 7,
      },
    });

    expect(first).toEqual(second);
    expect(first.status).toBe('PASSED');
    expect(first.confidenceInterval?.lower).toBeGreaterThan(0);
    expect(first.randomizationPValue).toBeLessThanOrEqual(0.05);
  });

  it('fails closed with insufficient independent pairs', () => {
    const result = evaluatePairedSignificance({
      outcomes: [
        { pairId: 'one', baselineValue: 0, candidateValue: 1 },
      ],
    });
    expect(result.status).toBe('REJECTED');
    expect(result.rejectionReasons).toContain(
      'INSUFFICIENT_INDEPENDENT_PAIRS',
    );
    expect(result.randomizationPValue).toBeNull();
  });
});

describe('adjustHolmBonferroni', () => {
  it('controls familywise error in deterministic hypothesis order', () => {
    const adjusted = adjustHolmBonferroni({
      alpha: 0.05,
      hypotheses: [
        { id: 'strong', rawPValue: 0.001, value: 'a' },
        { id: 'borderline', rawPValue: 0.03, value: 'b' },
        { id: 'missing', rawPValue: null, value: 'c' },
      ],
    });

    expect(adjusted.find((item) => item.id === 'strong')).toMatchObject({
      adjustedPValue: 0.002,
      rejectedAtAlpha: true,
    });
    expect(adjusted.find((item) => item.id === 'borderline')).toMatchObject({
      adjustedPValue: 0.03,
      rejectedAtAlpha: true,
    });
    expect(adjusted.find((item) => item.id === 'missing')).toMatchObject({
      adjustedPValue: null,
      rejectedAtAlpha: false,
    });
  });
});
