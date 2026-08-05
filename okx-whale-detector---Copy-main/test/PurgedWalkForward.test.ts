import { describe, expect, it } from 'vitest';

import {
  createPurgedWalkForwardPlan,
  type WalkForwardObservation,
} from '../src/research/PurgedWalkForward';

const observations = (): WalkForwardObservation[] =>
  Array.from({ length: 20 }, (_, index) => ({
    id: `observation-${index}`,
    observedAt: index * 1_000,
    episodeId:
      index === 4 || index === 6 ? 'shared-episode' : `episode-${index}`,
  }));

describe('createPurgedWalkForwardPlan', () => {
  it('keeps a final holdout untouched and purges temporal leakage', () => {
    const plan = createPurgedWalkForwardPlan({
      observations: observations(),
      policy: {
        trainSize: 6,
        testSize: 4,
        stepSize: 4,
        purgeMs: 2_000,
        embargoMs: 1_000,
        holdoutFraction: 0.2,
        anchoredTraining: false,
      },
    });

    expect(plan.discovery).toHaveLength(16);
    expect(plan.holdout.map((item) => item.id)).toEqual([
      'observation-16',
      'observation-17',
      'observation-18',
      'observation-19',
    ]);
    expect(plan.folds.length).toBeGreaterThan(0);

    const firstFold = plan.folds[0];
    expect(firstFold?.test.map((item) => item.id)).toEqual([
      'observation-6',
      'observation-7',
      'observation-8',
      'observation-9',
    ]);
    expect(firstFold?.train.map((item) => item.id)).not.toContain(
      'observation-4',
    );
    expect(firstFold?.purgedObservationCount).toBe(1);
    expect(firstFold?.overlappingEpisodeCount).toBe(1);

    const holdoutIds = new Set(plan.holdout.map((item) => item.id));
    for (const fold of plan.folds) {
      expect(fold.train.some((item) => holdoutIds.has(item.id))).toBe(false);
      expect(fold.test.some((item) => holdoutIds.has(item.id))).toBe(false);
    }
  });

  it('supports expanding anchored training windows', () => {
    const plan = createPurgedWalkForwardPlan({
      observations: observations(),
      policy: {
        trainSize: 6,
        testSize: 2,
        stepSize: 2,
        purgeMs: 0,
        embargoMs: 0,
        holdoutFraction: 0.1,
        anchoredTraining: true,
      },
    });

    expect(plan.folds[1]?.train.length).toBeGreaterThan(
      plan.folds[0]?.train.length ?? 0,
    );
  });

  it('rejects invalid holdout policies', () => {
    expect(() =>
      createPurgedWalkForwardPlan({
        observations: observations(),
        policy: {
          trainSize: 6,
          testSize: 2,
          stepSize: 2,
          purgeMs: 0,
          embargoMs: 0,
          holdoutFraction: 0.5,
          anchoredTraining: false,
        },
      }),
    ).toThrow('holdoutFraction');
  });
});
