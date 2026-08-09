import type { AlphaWalkForwardFold } from './alphaAnalysisTypes';
import type {
  AlphaResearchAnalysisConfig,
  AlphaResearchDatasetRow,
} from './alphaFeatureTypes';

export interface AlphaPurgedWalkForwardSplit {
  readonly discoveryRows: readonly AlphaResearchDatasetRow[];
  readonly finalHoldoutRows: readonly AlphaResearchDatasetRow[];
  readonly finalTrainingRows: readonly AlphaResearchDatasetRow[];
  readonly folds: readonly AlphaWalkForwardFold[];
}

const chronologicalRows = (
  rows: readonly AlphaResearchDatasetRow[],
): readonly AlphaResearchDatasetRow[] =>
  Object.freeze(
    [...rows].sort(
      (left, right) =>
        left.detectedAt - right.detectedAt ||
        left.instrumentId.localeCompare(right.instrumentId) ||
        left.alertId.localeCompare(right.alertId),
    ),
  );

const purgedTrainingRows = (
  candidates: readonly AlphaResearchDatasetRow[],
  testStartedAt: number,
  config: AlphaResearchAnalysisConfig,
): readonly AlphaResearchDatasetRow[] =>
  Object.freeze(
    candidates.filter(
      (row) =>
        row.detectedAt < testStartedAt - config.embargoMs &&
        row.outcomeObservedAt <= testStartedAt - config.purgeMs,
    ),
  );

export const createAlphaPurgedWalkForwardSplit = (
  rows: readonly AlphaResearchDatasetRow[],
  config: AlphaResearchAnalysisConfig,
): AlphaPurgedWalkForwardSplit => {
  const ordered = chronologicalRows(rows);
  if (ordered.length === 0) {
    return Object.freeze({
      discoveryRows: Object.freeze([]),
      finalHoldoutRows: Object.freeze([]),
      finalTrainingRows: Object.freeze([]),
      folds: Object.freeze([]),
    });
  }
  const holdoutCount = Math.max(
    1,
    Math.floor(ordered.length * config.holdoutFraction),
  );
  const discoveryCount = ordered.length - holdoutCount;
  const discoveryRows = Object.freeze(ordered.slice(0, discoveryCount));
  const finalHoldoutRows = Object.freeze(ordered.slice(discoveryCount));
  const holdoutStart = finalHoldoutRows[0]?.detectedAt;
  const finalTrainingRows =
    holdoutStart === undefined
      ? Object.freeze([])
      : purgedTrainingRows(discoveryRows, holdoutStart, config);

  const remainingAfterInitial =
    discoveryRows.length - config.minimumTrainingRows;
  if (remainingAfterInitial < config.foldCount) {
    return Object.freeze({
      discoveryRows,
      finalHoldoutRows,
      finalTrainingRows,
      folds: Object.freeze([]),
    });
  }

  const baseTestingSize = Math.floor(remainingAfterInitial / config.foldCount);
  const extraRows = remainingAfterInitial % config.foldCount;
  const folds: AlphaWalkForwardFold[] = [];
  let testingStartIndex = config.minimumTrainingRows;
  for (let foldIndex = 0; foldIndex < config.foldCount; foldIndex += 1) {
    const testingSize = baseTestingSize + (foldIndex < extraRows ? 1 : 0);
    const testingRows = Object.freeze(
      discoveryRows.slice(testingStartIndex, testingStartIndex + testingSize),
    );
    testingStartIndex += testingSize;
    const firstTestingRow = testingRows[0];
    const lastTestingRow = testingRows[testingRows.length - 1];
    if (firstTestingRow === undefined || lastTestingRow === undefined) continue;
    const trainingRows = purgedTrainingRows(
      discoveryRows.slice(0, testingStartIndex - testingSize),
      firstTestingRow.detectedAt,
      config,
    );
    if (trainingRows.length < config.minimumTrainingRows) continue;
    folds.push(
      Object.freeze({
        foldId: `walk-forward-${foldIndex + 1}`,
        trainingRows,
        testingRows,
        testStartedAt: firstTestingRow.detectedAt,
        testEndedAt: lastTestingRow.detectedAt,
      }),
    );
  }
  return Object.freeze({
    discoveryRows,
    finalHoldoutRows,
    finalTrainingRows,
    folds: Object.freeze(folds),
  });
};
