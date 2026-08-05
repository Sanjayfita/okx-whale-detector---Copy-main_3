import { describe, expect, it } from 'vitest';

import { compareStrategyCandidates } from '../src/research/strategyCandidateComparison';

describe('StrategyCandidateComparison', () => {
  it('compares higher-is-better and lower-is-better metrics deterministically', () => {
    const result = compareStrategyCandidates({
      baselineCandidateId: 'candidate:baseline',
      candidateCandidateId: 'candidate:challenger',
      metrics: [
        {
          name: 'drawdown',
          direction: 'LOWER_IS_BETTER',
          baseline: 0.2,
          candidate: 0.1,
          normalizationScale: 0.1,
          weight: 2,
        },
        {
          name: 'expectancy',
          direction: 'HIGHER_IS_BETTER',
          baseline: 1,
          candidate: 1.5,
          normalizationScale: 0.5,
        },
        {
          name: 'coverage',
          direction: 'HIGHER_IS_BETTER',
          baseline: 0.8,
          candidate: 0.8,
          normalizationScale: 0.1,
        },
      ],
    });

    expect(result.metrics.map((metric) => metric.name)).toEqual([
      'coverage',
      'drawdown',
      'expectancy',
    ]);
    expect(result.improvedCount).toBe(2);
    expect(result.unchangedCount).toBe(1);
    expect(result.degradedCount).toBe(0);
    expect(result.totalWeightedScore).toBeCloseTo(3);
    expect(result.verdict).toBe('BETTER');
  });

  it('reports insufficient data when every metric is unavailable', () => {
    const result = compareStrategyCandidates({
      baselineCandidateId: 'candidate:a',
      candidateCandidateId: 'candidate:b',
      metrics: [
        {
          name: 'expectancy',
          direction: 'HIGHER_IS_BETTER',
          baseline: null,
          candidate: null,
          normalizationScale: 0.1,
        },
      ],
    });
    expect(result.unavailableCount).toBe(1);
    expect(result.verdict).toBe('INSUFFICIENT_DATA');
  });

  it('rejects duplicate metric names and identical candidate IDs', () => {
    expect(() =>
      compareStrategyCandidates({
        baselineCandidateId: 'candidate:a',
        candidateCandidateId: 'candidate:a',
        metrics: [
          {
            name: 'x',
            direction: 'HIGHER_IS_BETTER',
            baseline: 1,
            candidate: 2,
            normalizationScale: 1,
          },
        ],
      }),
    ).toThrow('two different candidate IDs');

    expect(() =>
      compareStrategyCandidates({
        baselineCandidateId: 'candidate:a',
        candidateCandidateId: 'candidate:b',
        metrics: [
          {
            name: 'x',
            direction: 'HIGHER_IS_BETTER',
            baseline: 1,
            candidate: 2,
            normalizationScale: 1,
          },
          {
            name: 'x',
            direction: 'HIGHER_IS_BETTER',
            baseline: 1,
            candidate: 2,
            normalizationScale: 1,
          },
        ],
      }),
    ).toThrow('Duplicate metric name');

    expect(() =>
      compareStrategyCandidates({
        baselineCandidateId: 'candidate:a',
        candidateCandidateId: 'candidate:b',
        metrics: [
          {
            name: 'unscaled',
            direction: 'HIGHER_IS_BETTER',
            baseline: 1,
            candidate: 2,
            normalizationScale: 0,
          },
        ],
      }),
    ).toThrow('normalizationScale');
  });
});
