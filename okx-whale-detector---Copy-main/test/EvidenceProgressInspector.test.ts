import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createAlertOutcomeObservation } from '../src/research/alertOutcomeObservation';
import { captureAlphaFeatureValues } from '../src/research/alphaCapturedFeatures';
import { createAlphaResearchConfig } from '../src/research/alphaResearchConfig';
import { createAlphaResearchConfigurationFingerprint } from '../src/research/alphaResearchFingerprint';
import {
  ALPHA_RESEARCH_EVENT_SNAPSHOT_SCHEMA_VERSION,
  type AlphaResearchEventSnapshot,
} from '../src/research/alphaFeatureTypes';
import {
  createEvaluationSessionManifest,
  type EvaluationSessionManifest,
} from '../src/research/evaluationSessionManifest';
import { inspectEvidenceProgress } from '../src/research/evidenceProgressInspector';
import {
  createQualifiedAlertEvidenceRecord,
  type QualifiedAlertEvidenceRecord,
} from '../src/research/qualifiedAlertEvidence';

const START = 1_800_000_000_000;

const createEvaluation = async (
  instruments: readonly string[] = ['BTC-USDT'],
): Promise<{
  readonly directory: string;
  readonly manifest: EvaluationSessionManifest;
}> => {
  const directory = await mkdtemp(join(tmpdir(), 'evidence-progress-'));
  const alphaConfig = createAlphaResearchConfig();
  const configuration = {
    alphaResearchConfigurationFingerprint:
      createAlphaResearchConfigurationFingerprint(alphaConfig),
  };
  const manifest = createEvaluationSessionManifest({
    evaluationId: 'eval-test',
    sourceCommit: 'test-source',
    configuration,
    instruments,
    minimumCollectionDays: 1,
    minimumQualifiedAlerts: 1,
    minimumInstruments: instruments.length,
    createdAt: START,
  });
  await writeFile(
    join(directory, 'manifest.json'),
    `${JSON.stringify(manifest)}\n`,
    'utf8',
  );
  await writeFile(join(directory, 'qualified-alerts.ndjson'), '', 'utf8');
  await writeFile(join(directory, 'alpha-snapshots.ndjson'), '', 'utf8');
  await writeFile(join(directory, 'outcomes.ndjson'), '', 'utf8');
  await writeFile(
    join(directory, 'pending-observations.json'),
    JSON.stringify({
      schemaVersion: 1,
      pending: [],
      liveOrderExecutionAllowed: false,
    }),
    'utf8',
  );
  return { directory, manifest };
};

const createAlert = (
  manifest: EvaluationSessionManifest,
  input: { readonly id?: string; readonly instrumentId?: string } = {},
): QualifiedAlertEvidenceRecord =>
  createQualifiedAlertEvidenceRecord({
    evaluationId: manifest.evaluationId,
    alertId: input.id ?? 'a1',
    instrumentId: input.instrumentId ?? 'BTC-USDT',
    detectedAt: START + 1_000,
    recordedAt: START + 1_001,
    direction: 'BULLISH',
    signalType: 'BUY_PRESSURE',
    confidence: 80,
    referencePrice: 100,
    bestBid: 99.9,
    bestAsk: 100.1,
    spreadPercent: 0.2,
    sourceCommit: manifest.sourceCommit,
    configurationFingerprint: manifest.configurationFingerprint,
  });

const createSnapshot = (
  alert: QualifiedAlertEvidenceRecord,
): AlphaResearchEventSnapshot =>
  captureAlphaFeatureValues(
    Object.freeze({
      schemaVersion: ALPHA_RESEARCH_EVENT_SNAPSHOT_SCHEMA_VERSION,
      evidence: alert,
      candles: Object.freeze([]),
      orderBook: Object.freeze({
        eventTimestamp: alert.detectedAt,
        availabilityTimestamp: alert.detectedAt,
        bids: Object.freeze([Object.freeze({ price: 99.9, size: 2 })]),
        asks: Object.freeze([Object.freeze({ price: 100.1, size: 2 })]),
      }),
      trades: Object.freeze([]),
      whale: Object.freeze({
        availabilityTimestamp: alert.detectedAt,
        wallPersistenceMs: 10_000,
        refillCount: 1,
        spoofProbability: null,
        absorptionScore: null,
        executionRatio: null,
        whaleNotionalQuote: 1_000_000,
      }),
      synthetic: false,
      liveOrderExecutionAllowed: false,
    }),
    createAlphaResearchConfig(),
  );

const writeCompleteEvidence = async (
  directory: string,
  alert: QualifiedAlertEvidenceRecord,
): Promise<void> => {
  await writeFile(
    join(directory, 'qualified-alerts.ndjson'),
    `${JSON.stringify(alert)}\n`,
    'utf8',
  );
  await writeFile(
    join(directory, 'alpha-snapshots.ndjson'),
    `${JSON.stringify(createSnapshot(alert))}\n`,
    'utf8',
  );
  await writeFile(
    join(directory, 'outcomes.ndjson'),
    ([1, 5, 15, 30, 60] as const)
      .map((horizonMinutes) =>
        JSON.stringify(
          createAlertOutcomeObservation({
            evaluationId: alert.evaluationId,
            alertId: alert.alertId,
            instrumentId: alert.instrumentId,
            detectedAt: alert.detectedAt,
            horizonMinutes,
            observedAt: alert.detectedAt + horizonMinutes * 60_000,
            referencePrice: 100,
            observedPrice: 101,
            rawReturnPercent: 1,
            directionAdjustedReturnPercent: 1,
            maximumFavorableExcursionPercent: 1.2,
            maximumAdverseExcursionPercent: 0.2,
          }),
        ),
      )
      .join('\n') + '\n',
    'utf8',
  );
};

describe('inspectEvidenceProgress', () => {
  it('reports complete snapshots, features, outcomes, and fingerprints', async () => {
    const { directory, manifest } = await createEvaluation();
    await writeCompleteEvidence(directory, createAlert(manifest));

    const report = await inspectEvidenceProgress(directory, START + 86_400_000);

    expect(report.qualifiedAlertCount).toBe(1);
    expect(report.snapshotCount).toBe(1);
    expect(report.completedObservationCount).toBe(5);
    expect(report.completeBundleCount).toBe(1);
    expect(report.pendingObservationCount).toBe(0);
    expect(report.malformedRecordCount).toBe(0);
    expect(report.snapshotCompletenessRate).toBe(1);
    expect(report.outcomeCompletenessRate).toBe(1);
    expect(report.featureValueAvailabilityRate).not.toBeNull();
    expect(report.health).toBe('HEALTHY');
    expect(report.evaluationLeaseActive).toBe(false);
    expect(report.readyForFinalEvaluation).toBe(true);
    expect(report.evidenceSource.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('counts malformed source lines and blocks readiness', async () => {
    const { directory } = await createEvaluation();
    await writeFile(
      join(directory, 'qualified-alerts.ndjson'),
      'not-json\n',
      'utf8',
    );

    const report = await inspectEvidenceProgress(directory, START + 86_400_000);

    expect(report.malformedRecordCount).toBe(1);
    expect(report.health).toBe('UNHEALTHY');
    expect(report.readyForFinalEvaluation).toBe(false);
  });

  it('reports missing snapshots and incomplete outcomes separately', async () => {
    const { directory, manifest } = await createEvaluation();
    const alert = createAlert(manifest);
    await writeFile(
      join(directory, 'qualified-alerts.ndjson'),
      `${JSON.stringify(alert)}\n`,
      'utf8',
    );

    const report = await inspectEvidenceProgress(directory, START + 86_400_000);

    expect(report.missingSnapshotCount).toBe(1);
    expect(report.missingObservationCount).toBe(5);
    expect(report.incompleteBundleCount).toBe(1);
    expect(report.snapshotRequirementMet).toBe(false);
    expect(report.outcomeRequirementMet).toBe(false);
    expect(report.readyForFinalEvaluation).toBe(false);
  });

  it('blocks finalization when a legacy snapshot lacks persisted features', async () => {
    const { directory, manifest } = await createEvaluation();
    const alert = createAlert(manifest);
    await writeCompleteEvidence(directory, alert);
    await writeFile(
      join(directory, 'alpha-snapshots.ndjson'),
      `${JSON.stringify({ ...createSnapshot(alert), capturedFeatures: undefined })}\n`,
      'utf8',
    );

    const report = await inspectEvidenceProgress(directory, START + 86_400_000);

    expect(report.snapshotCount).toBe(1);
    expect(report.capturedFeatureSnapshotCount).toBe(0);
    expect(report.missingCapturedFeatureSnapshotCount).toBe(1);
    expect(report.health).toBe('DEGRADED');
    expect(report.readyForFinalEvaluation).toBe(false);
  });

  it('counts malformed pending jobs and excludes them from progress', async () => {
    const { directory } = await createEvaluation();
    await writeFile(
      join(directory, 'pending-observations.json'),
      JSON.stringify([
        {
          schemaVersion: 1,
          alertId: 'missing-required-fields',
          liveOrderExecutionAllowed: false,
        },
      ]),
      'utf8',
    );

    const report = await inspectEvidenceProgress(directory, START + 86_400_000);

    expect(report.pendingObservationCount).toBe(0);
    expect(report.malformedRecordCount).toBe(1);
    expect(report.readyForFinalEvaluation).toBe(false);
  });

  it('requires evidence across the configured minimum instruments', async () => {
    const { directory, manifest } = await createEvaluation([
      'BTC-USDT',
      'ETH-USDT',
    ]);
    await writeCompleteEvidence(directory, createAlert(manifest));

    const report = await inspectEvidenceProgress(directory, START + 86_400_000);

    expect(report.observedInstrumentCount).toBe(1);
    expect(report.minimumInstruments).toBe(2);
    expect(report.minimumInstrumentsMet).toBe(false);
    expect(report.readyForFinalEvaluation).toBe(false);
  });

  it('blocks finalization while collection or finalization owns the evaluation', async () => {
    const { directory, manifest } = await createEvaluation();
    await writeCompleteEvidence(directory, createAlert(manifest));
    await writeFile(join(directory, 'evaluation.lock'), '{}\n', 'utf8');

    const report = await inspectEvidenceProgress(directory, START + 86_400_000);

    expect(report.integrityValid).toBe(true);
    expect(report.evaluationLeaseActive).toBe(true);
    expect(report.readyForFinalEvaluation).toBe(false);
  });
});
