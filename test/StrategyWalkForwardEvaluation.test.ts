import { describe, expect, it } from 'vitest';

import { evaluateStrategyWalkForward } from '../src/research/strategyWalkForwardEvaluation';

const metrics = (baseline: number | null, candidate: number | null) => [
  {
    name: 'expectancy',
    direction: 'HIGHER_IS_BETTER' as const,
    baseline,
    candidate,
    normalizationScale: 1,
    weight: 2,
  },
];

describe('evaluateStrategyWalkForward', () => {
  it('classifies a candidate as robustly better across chronological windows', () => {
    const evaluation = evaluateStrategyWalkForward({
      baselineCandidateId: 'candidate:baseline',
      candidateCandidateId: 'candidate:challenger',
      windows: [
        {
          windowId: 'window:2',
          startedAt: 20,
          endedAt: 30,
          metrics: metrics(1, 2),
        },
        {
          windowId: 'window:1',
          startedAt: 10,
          endedAt: 20,
          metrics: metrics(1, 1.5),
        },
      ],
    });

    expect(evaluation.windows.map((window) => window.windowId)).toEqual([
      'window:1',
      'window:2',
    ]);
    expect(evaluation.betterCount).toBe(2);
    expect(evaluation.cumulativeWeightedScore).toBe(3);
    expect(evaluation.verdict).toBe('ROBUSTLY_BETTER');
  });

  it('classifies inconsistent windows as mixed', () => {
    const evaluation = evaluateStrategyWalkForward({
      baselineCandidateId: 'candidate:baseline',
      candidateCandidateId: 'candidate:challenger',
      windows: [
        {
          windowId: 'window:1',
          startedAt: 10,
          endedAt: 20,
          metrics: metrics(1, 2),
        },
        {
          windowId: 'window:2',
          startedAt: 20,
          endedAt: 30,
          metrics: metrics(1, 0),
        },
      ],
    });

    expect(evaluation.betterCount).toBe(1);
    expect(evaluation.worseCount).toBe(1);
    expect(evaluation.verdict).toBe('MIXED');
  });

  it('reports insufficient data when all windows are unavailable', () => {
    const evaluation = evaluateStrategyWalkForward({
      baselineCandidateId: 'candidate:baseline',
      candidateCandidateId: 'candidate:challenger',
      windows: [
        {
          windowId: 'window:1',
          startedAt: 10,
          endedAt: 20,
          metrics: metrics(null, null),
        },
        {
          windowId: 'window:2',
          startedAt: 20,
          endedAt: 30,
          metrics: metrics(null, null),
        },
      ],
    });

    expect(evaluation.insufficientDataCount).toBe(2);
    expect(evaluation.verdict).toBe('INSUFFICIENT_DATA');
  });

  it('rejects duplicate, overlapping, and insufficient windows', () => {
    expect(() =>
      evaluateStrategyWalkForward({
        baselineCandidateId: 'candidate:baseline',
        candidateCandidateId: 'candidate:challenger',
        windows: [
          {
            windowId: 'window:1',
            startedAt: 10,
            endedAt: 20,
            metrics: metrics(1, 2),
          },
        ],
      }),
    ).toThrow('at least two windows');

    expect(() =>
      evaluateStrategyWalkForward({
        baselineCandidateId: 'candidate:baseline',
        candidateCandidateId: 'candidate:challenger',
        windows: [
          {
            windowId: 'window:1',
            startedAt: 10,
            endedAt: 25,
            metrics: metrics(1, 2),
          },
          {
            windowId: 'window:2',
            startedAt: 20,
            endedAt: 30,
            metrics: metrics(1, 2),
          },
        ],
      }),
    ).toThrow('must not overlap');
  });
});
