import { describe, expect, it } from 'vitest';

import { extractAlphaFeatures } from '../src/research/alphaFeatureExtractor';
import type { AlphaResearchDatasetRow } from '../src/research/alphaFeatureTypes';
import { simulateAlphaEpisodePaths } from '../src/research/alphaMonteCarlo';
import { createAlphaResearchConfig } from '../src/research/alphaResearchConfig';
import { createAlphaSnapshotFixture } from './AlphaResearchFixtures';

const features = extractAlphaFeatures(
  createAlphaSnapshotFixture(),
  createAlphaResearchConfig().extraction,
).values;

const createRow = (
  alertId: string,
  detectedAt: number,
  netReturnPercent: number,
): AlphaResearchDatasetRow =>
  Object.freeze({
    evaluationId: 'monte-carlo-fixture',
    alertId,
    instrumentId: 'BTC-USDT',
    detectedAt,
    direction: 'BULLISH',
    outcomeObservedAt: detectedAt + 15 * 60_000,
    horizonMinutes: 15,
    grossReturnPercent: netReturnPercent + 0.2,
    netReturnPercent,
    features,
    synthetic: true,
  });

describe('alpha Monte Carlo', () => {
  it('resamples whole episodes reproducibly and reports path drawdown', () => {
    const rows = [
      createRow('a', 1, 0.4),
      createRow('b', 2, -0.3),
      createRow('c', 3, 0.2),
      createRow('d', 4, -0.1),
    ];
    const episodeIds = new Map([
      ['a', 'episode-1'],
      ['b', 'episode-1'],
      ['c', 'episode-2'],
      ['d', 'episode-3'],
    ]);
    const input = { rows, episodeIds, iterations: 100, seed: 42 } as const;

    const first = simulateAlphaEpisodePaths(input);
    const second = simulateAlphaEpisodePaths(input);

    expect(first).toEqual(second);
    expect(first.independentEpisodeCount).toBe(3);
    expect(first.cumulativeReturnP50Percent).not.toBeNull();
    expect(first.maximumDrawdownP95Percent).toBeGreaterThan(0);
  });

  it('fails when dependency assignments are incomplete', () => {
    expect(() =>
      simulateAlphaEpisodePaths({
        rows: [createRow('missing', 1, 0.1)],
        episodeIds: new Map(),
        iterations: 100,
        seed: 1,
      }),
    ).toThrow('Missing episode assignment');
  });
});
