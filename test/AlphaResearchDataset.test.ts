import { describe, expect, it } from 'vitest';

import { createAlertOutcomeObservation } from '../src/research/alertOutcomeObservation';
import { createAlphaResearchConfig } from '../src/research/alphaResearchConfig';
import { createAlphaResearchDataset } from '../src/research/alphaResearchDataset';
import { validateAlphaResearchDataset } from '../src/research/alphaResearchDataset';
import {
  ALPHA_FIXTURE_EVALUATION_ID,
  createAlphaOutcomeFixture,
  createAlphaSnapshotFixture,
} from './AlphaResearchFixtures';

describe('alpha research dataset', () => {
  it('joins one target outcome per whale alert and applies cost exactly once', () => {
    const snapshot = createAlphaSnapshotFixture();
    const targetOutcome = createAlphaOutcomeFixture({
      snapshot,
      directionalReturnPercent: 0.5,
    });
    const otherHorizon = createAlphaOutcomeFixture({
      snapshot,
      directionalReturnPercent: 0.1,
      horizonMinutes: 5,
    });
    const dataset = createAlphaResearchDataset({
      evaluationId: ALPHA_FIXTURE_EVALUATION_ID,
      snapshots: [snapshot],
      outcomes: [targetOutcome, otherHorizon],
      config: createAlphaResearchConfig(),
    });

    expect(dataset.rows).toHaveLength(1);
    expect(dataset.inputAlertCount).toBe(1);
    expect(dataset.rows[0].grossReturnPercent).toBeCloseTo(0.5);
    expect(dataset.rows[0].netReturnPercent).toBeCloseTo(0.3);
    expect(dataset.roundTripCostPercent).toBe(0.2);
    expect(dataset.ignoredOtherHorizonOutcomes).toBe(1);
    expect(dataset.unmatchedSnapshots).toBe(0);
    expect(dataset.unmatchedOutcomes).toBe(0);
    expect(dataset.liveOrderExecutionAllowed).toBe(false);
  });

  it('preserves transparent accounting for unmatched snapshots and outcomes', () => {
    const matched = createAlphaSnapshotFixture({ alertId: 'matched' });
    const unmatchedSnapshot = createAlphaSnapshotFixture({
      alertId: 'snapshot-only',
      detectedAt: matched.evidence.detectedAt + 2 * 60 * 60_000,
    });
    const outcomeOnlySnapshot = createAlphaSnapshotFixture({
      alertId: 'outcome-only',
      detectedAt: matched.evidence.detectedAt + 4 * 60 * 60_000,
    });
    const dataset = createAlphaResearchDataset({
      evaluationId: ALPHA_FIXTURE_EVALUATION_ID,
      snapshots: [matched, unmatchedSnapshot],
      outcomes: [
        createAlphaOutcomeFixture({ snapshot: matched }),
        createAlphaOutcomeFixture({ snapshot: outcomeOnlySnapshot }),
      ],
      config: createAlphaResearchConfig(),
    });

    expect(dataset.rows).toHaveLength(1);
    expect(dataset.inputSnapshotCount).toBe(2);
    expect(dataset.inputOutcomeCount).toBe(2);
    expect(dataset.unmatchedSnapshots).toBe(1);
    expect(dataset.unmatchedOutcomes).toBe(1);
  });

  it('uses qualified alerts as the authoritative population and counts missing snapshots', () => {
    const snapshot = createAlphaSnapshotFixture({ alertId: 'has-snapshot' });
    const missing = createAlphaSnapshotFixture({
      alertId: 'missing-snapshot',
      detectedAt: snapshot.evidence.detectedAt + 60_000,
    });
    const dataset = createAlphaResearchDataset({
      evaluationId: ALPHA_FIXTURE_EVALUATION_ID,
      qualifiedAlerts: [snapshot.evidence, missing.evidence],
      snapshots: [snapshot],
      outcomes: [createAlphaOutcomeFixture({ snapshot })],
      config: createAlphaResearchConfig(),
    });

    expect(dataset.inputAlertCount).toBe(2);
    expect(dataset.inputSnapshotCount).toBe(1);
    expect(dataset.missingSnapshots).toBe(1);
    expect(dataset.rows).toHaveLength(1);
  });

  it('rejects duplicate outcomes and a leaked or directionally inconsistent label', () => {
    const snapshot = createAlphaSnapshotFixture();
    const outcome = createAlphaOutcomeFixture({ snapshot });
    expect(() =>
      createAlphaResearchDataset({
        evaluationId: ALPHA_FIXTURE_EVALUATION_ID,
        snapshots: [snapshot],
        outcomes: [outcome, outcome],
        config: createAlphaResearchConfig(),
      }),
    ).toThrow('Duplicate target-horizon outcome');

    const inconsistent = createAlertOutcomeObservation({
      evaluationId: outcome.evaluationId,
      alertId: outcome.alertId,
      instrumentId: outcome.instrumentId,
      detectedAt: outcome.detectedAt,
      horizonMinutes: outcome.horizonMinutes,
      observedAt: outcome.observedAt,
      referencePrice: outcome.referencePrice,
      observedPrice: outcome.observedPrice,
      rawReturnPercent: outcome.rawReturnPercent,
      directionAdjustedReturnPercent: -outcome.directionAdjustedReturnPercent,
      maximumFavorableExcursionPercent:
        outcome.maximumFavorableExcursionPercent,
      maximumAdverseExcursionPercent: outcome.maximumAdverseExcursionPercent,
    });
    expect(() =>
      createAlphaResearchDataset({
        evaluationId: ALPHA_FIXTURE_EVALUATION_ID,
        snapshots: [snapshot],
        outcomes: [inconsistent],
        config: createAlphaResearchConfig(),
      }),
    ).toThrow('Outcome does not match qualified alert');
  });

  it('validates identity and uniqueness before ignoring non-target horizons', () => {
    const snapshot = createAlphaSnapshotFixture({ alertId: 'known' });
    const unknown = createAlphaSnapshotFixture({
      alertId: 'unknown',
      detectedAt: snapshot.evidence.detectedAt + 60_000,
    });
    const unknownOtherHorizon = createAlphaOutcomeFixture({
      snapshot: unknown,
      horizonMinutes: 5,
    });
    const dataset = createAlphaResearchDataset({
      evaluationId: ALPHA_FIXTURE_EVALUATION_ID,
      qualifiedAlerts: [snapshot.evidence],
      snapshots: [snapshot],
      outcomes: [createAlphaOutcomeFixture({ snapshot }), unknownOtherHorizon],
      config: createAlphaResearchConfig(),
    });

    expect(dataset.unmatchedOutcomes).toBe(1);
    expect(dataset.ignoredOtherHorizonOutcomes).toBe(0);
    const knownOtherHorizon = createAlphaOutcomeFixture({
      snapshot,
      horizonMinutes: 5,
    });
    expect(() =>
      createAlphaResearchDataset({
        evaluationId: ALPHA_FIXTURE_EVALUATION_ID,
        snapshots: [snapshot],
        outcomes: [knownOtherHorizon, knownOtherHorizon],
        config: createAlphaResearchConfig(),
      }),
    ).toThrow('Duplicate outcome');
  });

  it('handles bearish returns without reversing cost or PnL twice', () => {
    const snapshot = createAlphaSnapshotFixture({ direction: 'BEARISH' });
    const outcome = createAlphaOutcomeFixture({
      snapshot,
      directionalReturnPercent: 0.7,
    });
    const dataset = createAlphaResearchDataset({
      evaluationId: ALPHA_FIXTURE_EVALUATION_ID,
      snapshots: [snapshot],
      outcomes: [outcome],
      config: createAlphaResearchConfig(),
    });

    expect(outcome.rawReturnPercent).toBeCloseTo(-0.7);
    expect(dataset.rows[0].grossReturnPercent).toBeCloseTo(0.7);
    expect(dataset.rows[0].netReturnPercent).toBeCloseTo(0.5);
  });

  it('rejects non-finite feature values and inconsistent net-cost arithmetic', () => {
    const snapshot = createAlphaSnapshotFixture();
    const dataset = createAlphaResearchDataset({
      evaluationId: ALPHA_FIXTURE_EVALUATION_ID,
      snapshots: [snapshot],
      outcomes: [createAlphaOutcomeFixture({ snapshot })],
      config: createAlphaResearchConfig(),
    });
    expect(() =>
      validateAlphaResearchDataset({
        ...dataset,
        rows: [
          {
            ...dataset.rows[0],
            features: {
              ...dataset.rows[0].features,
              adx: Number.NaN,
            },
          },
        ],
      }),
    ).toThrow('feature vector');
    expect(() =>
      validateAlphaResearchDataset({
        ...dataset,
        rows: [{ ...dataset.rows[0], netReturnPercent: 99 }],
      }),
    ).toThrow('dataset row');
  });
});
