import { describe, expect, it } from 'vitest';

import {
  createPurgedWalkForwardPlan,
  type WalkForwardObservation,
} from '../src/research/PurgedWalkForward';

const observations = (count = 30): WalkForwardObservation[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `observation-${index}`,
    observedAt: index * 1_000,
    labelEndAt: index * 1_000 + 750,
    episodeId:
      index === 4 || index === 8 ? 'shared-discovery-episode' : `episode-${index}`,
  }));

describe('createPurgedWalkForwardPlan', () => {
  it('keeps whole episodes in the holdout and purges label overlap', () => {
    const plan = createPurgedWalkForwardPlan({
      observations: observations(),
      policy: {
        trainSize: 8,
        testSize: 5,
        stepSize: 4,
        purgeMs: 500,
        embargoMs: 250,
        holdoutFraction: 0.2,
        anchoredTraining: false,
      },
    });

    expect(plan.holdout).toHaveLength(6);
    expect(plan.holdout.map((item) => item.id)).toEqual([
      'observation-24',
      'observation-25',
      'observation-26',
      'observation-27',
      'observation-28',
      'observation-29',
    ]);
    expect(plan.holdoutBoundaryAt).toBe(24_000);
    expect(plan.folds.length).toBeGreaterThan(0);

    const holdoutEpisodes = new Set(
      plan.holdout.map((observation) => observation.episodeId),
    );
    expect(
      plan.discovery.some((observation) =>
        holdoutEpisodes.has(observation.episodeId),
      ),
    ).toBe(false);

    for (const fold of plan.folds) {
      expect(
        Math.max(...fold.train.map((item) => item.labelEndAt ?? item.observedAt)),
      ).toBeLessThanOrEqual(fold.firstTestObservedAt - 500);
      const testEpisodes = new Set(fold.test.map((item) => item.episodeId));
      expect(
        fold.train.some((item) => testEpisodes.has(item.episodeId)),
      ).toBe(false);
    }
  });

  it('moves an episode that spans the nominal boundary entirely into holdout', () => {
    const input = observations(12).map((observation, index) =>
      index === 1 || index === 11
        ? { ...observation, episodeId: 'boundary-spanning-episode' }
        : observation,
    );
    const plan = createPurgedWalkForwardPlan({
      observations: input,
      policy: {
        trainSize: 3,
        testSize: 2,
        stepSize: 2,
        purgeMs: 0,
        embargoMs: 0,
        holdoutFraction: 0.2,
        anchoredTraining: false,
      },
    });

    expect(plan.holdout.map((item) => item.id)).toContain('observation-1');
    expect(plan.holdout.map((item) => item.id)).toContain('observation-11');
    expect(
      plan.discovery.some(
        (item) => item.episodeId === 'boundary-spanning-episode',
      ),
    ).toBe(false);
  });

  it('supports expanding anchored training windows', () => {
    const plan = createPurgedWalkForwardPlan({
      observations: observations(40),
      policy: {
        trainSize: 8,
        testSize: 3,
        stepSize: 3,
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

  it('rejects invalid label intervals and holdout policies', () => {
    expect(() =>
      createPurgedWalkForwardPlan({
        observations: [
          {
            id: 'invalid',
            observedAt: 2_000,
            labelEndAt: 1_000,
            episodeId: 'episode',
          },
          {
            id: 'valid',
            observedAt: 3_000,
            episodeId: 'episode-2',
          },
        ],
        policy: {
          trainSize: 1,
          testSize: 1,
          stepSize: 1,
          purgeMs: 0,
          embargoMs: 0,
          holdoutFraction: 0.2,
          anchoredTraining: false,
        },
      }),
    ).toThrow('invalid observation interval');

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
