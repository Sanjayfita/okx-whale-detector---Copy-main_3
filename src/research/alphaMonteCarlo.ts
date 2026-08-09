import type { AlphaMonteCarloEstimate } from './alphaAnalysisTypes';
import type { AlphaResearchDatasetRow } from './alphaFeatureTypes';
import {
  alphaQuantile,
  createAlphaRandom,
  shuffledAlphaIndices,
} from './alphaStatistics';
import { requireArrayElement } from '../core/arrayAccess';

export const simulateAlphaEpisodePaths = (input: {
  readonly rows: readonly AlphaResearchDatasetRow[];
  readonly episodeIds: ReadonlyMap<string, string>;
  readonly iterations: number;
  readonly seed: number;
}): AlphaMonteCarloEstimate => {
  if (!Number.isSafeInteger(input.iterations) || input.iterations < 1) {
    throw new Error('Monte Carlo iterations must be a positive safe integer');
  }
  if (input.rows.length === 0) {
    return Object.freeze({
      sampleSize: 0,
      independentEpisodeCount: 0,
      iterations: input.iterations,
      cumulativeReturnP05Percent: null,
      cumulativeReturnP50Percent: null,
      cumulativeReturnP95Percent: null,
      maximumDrawdownP50Percent: null,
      maximumDrawdownP95Percent: null,
    });
  }
  const episodeRows = new Map<string, AlphaResearchDatasetRow[]>();
  for (const row of input.rows) {
    if (!Number.isFinite(row.netReturnPercent)) {
      throw new Error('Monte Carlo returns must be finite');
    }
    const episodeId = input.episodeIds.get(row.alertId);
    if (episodeId === undefined) {
      throw new Error(`Missing episode assignment for alert ${row.alertId}`);
    }
    const rows = episodeRows.get(episodeId) ?? [];
    rows.push(row);
    episodeRows.set(episodeId, rows);
  }
  const episodes = [...episodeRows.values()].map((rows) =>
    Object.freeze(
      [...rows]
        .sort(
          (left, right) =>
            left.detectedAt - right.detectedAt ||
            left.alertId.localeCompare(right.alertId),
        )
        .map((row) => row.netReturnPercent),
    ),
  );
  const random = createAlphaRandom(input.seed);
  const cumulativeReturns: number[] = [];
  const maximumDrawdowns: number[] = [];
  for (let iteration = 0; iteration < input.iterations; iteration += 1) {
    const sampledEpisodes = Array.from({ length: episodes.length }, () =>
      requireArrayElement(
        episodes,
        Math.floor(random() * episodes.length),
        'Monte Carlo sampled episode',
      ),
    );
    const pathOrder = shuffledAlphaIndices(sampledEpisodes.length, random);
    let cumulative = 0;
    let peak = 0;
    let maximumDrawdown = 0;
    for (const episodeIndex of pathOrder) {
      const episode = requireArrayElement(
        sampledEpisodes,
        episodeIndex,
        'Monte Carlo ordered episode',
      );
      for (const netReturnPercent of episode) {
        cumulative += netReturnPercent;
        peak = Math.max(peak, cumulative);
        maximumDrawdown = Math.max(maximumDrawdown, peak - cumulative);
      }
    }
    cumulativeReturns.push(cumulative);
    maximumDrawdowns.push(maximumDrawdown);
  }
  return Object.freeze({
    sampleSize: input.rows.length,
    independentEpisodeCount: episodes.length,
    iterations: input.iterations,
    cumulativeReturnP05Percent: alphaQuantile(cumulativeReturns, 0.05),
    cumulativeReturnP50Percent: alphaQuantile(cumulativeReturns, 0.5),
    cumulativeReturnP95Percent: alphaQuantile(cumulativeReturns, 0.95),
    maximumDrawdownP50Percent: alphaQuantile(maximumDrawdowns, 0.5),
    maximumDrawdownP95Percent: alphaQuantile(maximumDrawdowns, 0.95),
  });
};
