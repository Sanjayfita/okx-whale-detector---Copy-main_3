import { describe, expect, it } from 'vitest';

import {
  ALERT_OUTCOME_HORIZONS_MINUTES,
  createAlertOutcomeObservation,
} from '../src/research/alertOutcomeObservation';
import { createChronologicalDatasetSplit } from '../src/research/chronologicalDatasetSplit';
import { createQualifiedAlertEvidenceRecord } from '../src/research/qualifiedAlertEvidence';
import {
  createQualifiedAlertOutcomeBundle,
  type QualifiedAlertOutcomeBundle,
} from '../src/research/qualifiedAlertOutcomeBundle';

const BASE_TIMESTAMP = 1_700_000_000_000;
const TWO_HOURS_MS = 2 * 60 * 60_000;

const timestampAt = (index: number): number =>
  BASE_TIMESTAMP + index * TWO_HOURS_MS;

const bundle = (
  alertId: string,
  detectedAt: number,
  evaluationId = 'evaluation-q6',
  collectionDelayMs = 0,
): QualifiedAlertOutcomeBundle => {
  const evidence = createQualifiedAlertEvidenceRecord({
    evaluationId,
    alertId,
    instrumentId: 'BTC-USDT',
    detectedAt,
    recordedAt: detectedAt,
    direction: 'BULLISH',
    signalType: 'WHALE_ALERT',
    confidence: 80,
    referencePrice: 100,
    bestBid: 99,
    bestAsk: 101,
    spreadPercent: 2,
    sourceCommit: 'abc123',
    configurationFingerprint: 'config-1',
  });
  const observations = ALERT_OUTCOME_HORIZONS_MINUTES.map((horizonMinutes) =>
    createAlertOutcomeObservation({
      evaluationId,
      alertId,
      instrumentId: 'BTC-USDT',
      detectedAt,
      horizonMinutes,
      observedAt: detectedAt + horizonMinutes * 60_000 + collectionDelayMs,
      referencePrice: 100,
      observedPrice: 101,
      rawReturnPercent: 1,
      directionAdjustedReturnPercent: 1,
      maximumFavorableExcursionPercent: 1.5,
      maximumAdverseExcursionPercent: 0.5,
    }),
  );
  return createQualifiedAlertOutcomeBundle({ evidence, observations });
};

describe('createChronologicalDatasetSplit', () => {
  it('sorts bundles and creates label-safe 60/20/20 partitions', () => {
    const result = createChronologicalDatasetSplit({
      bundles: [
        bundle('alert-5', timestampAt(4)),
        bundle('alert-1', timestampAt(0)),
        bundle('alert-4', timestampAt(3)),
        bundle('alert-2', timestampAt(1)),
        bundle('alert-3', timestampAt(2)),
      ],
    });

    expect(result.training.map((item) => item.evidence.alertId)).toEqual([
      'alert-1',
      'alert-2',
      'alert-3',
    ]);
    expect(result.validation.map((item) => item.evidence.alertId)).toEqual([
      'alert-4',
    ]);
    expect(result.testing.map((item) => item.evidence.alertId)).toEqual([
      'alert-5',
    ]);
    expect(result.schemaVersion).toBe(2);
    expect(result.purgedTrainingBundles).toBe(0);
    expect(result.purgedValidationBundles).toBe(0);
    expect(result.chronological).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.liveOrderExecutionAllowed).toBe(false);
  });

  it('supports custom percentages that total 100', () => {
    const result = createChronologicalDatasetSplit({
      bundles: Array.from({ length: 10 }, (_, index) =>
        bundle(`alert-${index}`, timestampAt(index)),
      ),
      trainingPercent: 50,
      validationPercent: 30,
      testingPercent: 20,
    });

    expect(result.training).toHaveLength(5);
    expect(result.validation).toHaveLength(3);
    expect(result.testing).toHaveLength(2);
  });

  it('purges a training label that was unavailable at validation time', () => {
    const bundles = Array.from({ length: 10 }, (_, index) =>
      bundle(
        `alert-${index}`,
        timestampAt(index),
        'evaluation-q6',
        index === 5 ? TWO_HOURS_MS : 0,
      ),
    );
    const result = createChronologicalDatasetSplit({
      bundles,
      purgeMs: 1,
      embargoMs: 1,
    });

    expect(result.purgedTrainingBundles).toBe(1);
    expect(result.training.map((item) => item.evidence.alertId)).not.toContain(
      'alert-5',
    );
    expect(
      Math.max(
        ...result.training.flatMap((item) =>
          item.observations.map((observation) => observation.observedAt),
        ),
      ),
    ).toBeLessThan(result.validation[0]?.evidence.detectedAt ?? 0);
  });

  it('rejects percentages that do not total 100', () => {
    expect(() =>
      createChronologicalDatasetSplit({
        bundles: Array.from({ length: 5 }, (_, index) =>
          bundle(`alert-${index}`, timestampAt(index)),
        ),
        trainingPercent: 50,
        validationPercent: 20,
        testingPercent: 20,
      }),
    ).toThrow('Dataset split percentages must total exactly 100');
  });

  it('rejects mixed evaluations and duplicate timestamps', () => {
    expect(() =>
      createChronologicalDatasetSplit({
        bundles: [
          bundle('a', timestampAt(0)),
          bundle('b', timestampAt(1)),
          bundle('c', timestampAt(2)),
          bundle('d', timestampAt(3)),
          bundle('e', timestampAt(4), 'another-evaluation'),
        ],
      }),
    ).toThrow('All bundles must belong to the same evaluation');

    expect(() =>
      createChronologicalDatasetSplit({
        bundles: [
          bundle('a', timestampAt(0)),
          bundle('b', timestampAt(1)),
          bundle('c', timestampAt(2)),
          bundle('d', timestampAt(3)),
          bundle('e', timestampAt(3)),
        ],
      }),
    ).toThrow('Bundle detection timestamps must be unique');
  });
});
