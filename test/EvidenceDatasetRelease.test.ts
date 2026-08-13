import {
  appendFile,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ALERT_OUTCOME_HORIZONS_MINUTES,
  createAlertOutcomeObservation,
} from '../src/research/alertOutcomeObservation';
import { captureAlphaFeatureValues } from '../src/research/alphaCapturedFeatures';
import { createAlphaResearchConfig } from '../src/research/alphaResearchConfig';
import { createAlphaResearchConfigurationFingerprint } from '../src/research/alphaResearchFingerprint';
import {
  ALPHA_FEATURE_NAMES,
  ALPHA_RESEARCH_EVENT_SNAPSHOT_SCHEMA_VERSION,
  type AlphaResearchEventSnapshot,
} from '../src/research/alphaFeatureTypes';
import {
  createEvidenceDatasetRelease,
  type EvidenceDatasetReleaseManifest,
  verifyEvidenceDatasetRelease,
} from '../src/research/evidenceDatasetRelease';
import { EvidenceEvaluationLease } from '../src/research/evidenceEvaluationLease';
import { createFileSha256 } from '../src/research/evidenceSourceFingerprint';
import {
  createEvaluationSessionManifest,
  type EvaluationSessionManifest,
} from '../src/research/evaluationSessionManifest';
import {
  createQualifiedAlertEvidenceRecord,
  type QualifiedAlertEvidenceRecord,
} from '../src/research/qualifiedAlertEvidence';

const START = 1_800_000_000_000;
const EVALUATION_ID = 'release-test';

const setupEvaluation = async (): Promise<{
  readonly directory: string;
  readonly manifest: EvaluationSessionManifest;
  readonly alert: QualifiedAlertEvidenceRecord;
}> => {
  const directory = await mkdtemp(join(tmpdir(), 'evidence-release-'));
  const alphaConfig = createAlphaResearchConfig();
  const manifest = createEvaluationSessionManifest({
    evaluationId: EVALUATION_ID,
    sourceCommit: 'source-commit',
    configuration: {
      alphaResearchConfig: alphaConfig,
      alphaResearchConfigurationFingerprint:
        createAlphaResearchConfigurationFingerprint(alphaConfig),
    },
    instruments: ['BTC-USDT'],
    minimumCollectionDays: 1,
    minimumQualifiedAlerts: 1,
    minimumInstruments: 1,
    createdAt: START,
  });
  const alert = createQualifiedAlertEvidenceRecord({
    evaluationId: EVALUATION_ID,
    alertId: 'alert-1',
    instrumentId: 'BTC-USDT',
    detectedAt: START + 1_000,
    recordedAt: START + 1_001,
    direction: 'BULLISH',
    signalType: 'WHALE_ABSORPTION',
    confidence: 80,
    referencePrice: 100,
    bestBid: 99.9,
    bestAsk: 100.1,
    spreadPercent: 0.2,
    sourceCommit: manifest.sourceCommit,
    configurationFingerprint: manifest.configurationFingerprint,
  });
  const snapshot: AlphaResearchEventSnapshot = captureAlphaFeatureValues(
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
        wallPersistenceMs: 15_000,
        refillCount: 2,
        spoofProbability: null,
        absorptionScore: null,
        executionRatio: 0.5,
        whaleNotionalQuote: 1_000_000,
      }),
      derivatives: Object.freeze({
        availabilityTimestamp: alert.detectedAt,
        fundingRate: null,
        nextFundingTimestamp: null,
        openInterest: null,
        openInterestChange: null,
        missing: true as const,
      }),
      integrity: Object.freeze({
        eventTimestamp: alert.detectedAt,
        featureTimestamp: alert.detectedAt,
        maximumSourceAvailabilityTimestamp: alert.detectedAt,
        featureRegistryVersion: 'alpha-feature-registry-v1' as const,
        temporalIntegrityVerified: true as const,
        dataQualityFlags: Object.freeze([
          'DERIVATIVES_FUNDING_MISSING',
          'DERIVATIVES_OPEN_INTEREST_MISSING',
        ]),
      }),
      synthetic: false,
      liveOrderExecutionAllowed: false,
    }),
    alphaConfig,
  );
  const outcomes = ALERT_OUTCOME_HORIZONS_MINUTES.map((horizonMinutes) =>
    createAlertOutcomeObservation({
      evaluationId: EVALUATION_ID,
      alertId: alert.alertId,
      instrumentId: alert.instrumentId,
      detectedAt: alert.detectedAt,
      horizonMinutes,
      observedAt: alert.detectedAt + Math.round(horizonMinutes * 60_000),
      referencePrice: 100,
      observedPrice: 100.5,
      rawReturnPercent: 0.5,
      directionAdjustedReturnPercent: 0.5,
      maximumFavorableExcursionPercent: 0.5,
      maximumAdverseExcursionPercent: 0,
      maximumUpwardExcursionPercent: 0.5,
      maximumDownwardExcursionPercent: 0,
      timeToMaximumFavorableExcursionMs: Math.round(horizonMinutes * 60_000),
      timeToMaximumAdverseExcursionMs: 0,
      timeToMaximumUpwardExcursionMs: Math.round(horizonMinutes * 60_000),
      timeToMaximumDownwardExcursionMs: 0,
      pathSampleCount: 1,
      pathSampling: 'STANDARDIZED_HORIZON_SAMPLES',
      excursionMeasurement: 'OBSERVED_PATH',
    }),
  );

  await Promise.all([
    writeFile(
      join(directory, 'manifest.json'),
      `${JSON.stringify(manifest)}\n`,
    ),
    writeFile(
      join(directory, 'qualified-alerts.ndjson'),
      `${JSON.stringify(alert)}\n`,
    ),
    writeFile(
      join(directory, 'alpha-snapshots.ndjson'),
      `${JSON.stringify(snapshot)}\n`,
    ),
    writeFile(
      join(directory, 'outcomes.ndjson'),
      `${outcomes.map((outcome) => JSON.stringify(outcome)).join('\n')}\n`,
    ),
    writeFile(join(directory, 'quarantined-episodes.ndjson'), ''),
    writeFile(join(directory, 'coverage-gaps.ndjson'), ''),
    writeFile(
      join(directory, 'pending-observations.json'),
      `${JSON.stringify({ schemaVersion: 1, pending: [], liveOrderExecutionAllowed: false })}\n`,
    ),
  ]);
  return Object.freeze({ directory, manifest, alert });
};

describe('createEvidenceDatasetRelease', () => {
  it('freezes complete evidence into a content-addressed immutable release', async () => {
    const { directory } = await setupEvaluation();
    const release = await createEvidenceDatasetRelease({
      evaluationId: EVALUATION_ID,
      evaluationDirectory: directory,
      createdAt: START + 86_400_000,
      sourceCommit: 'source-commit',
      gitStatus: '',
    });
    const persistedManifest = JSON.parse(
      await readFile(join(release.directory, 'release-manifest.json'), 'utf8'),
    ) as EvidenceDatasetReleaseManifest;

    expect(basename(release.directory)).toBe(
      release.manifest.releaseFingerprint,
    );
    expect(release.manifest.quality.readyForFinalEvaluation).toBe(true);
    expect(release.manifest.quality.health).toBe('HEALTHY');
    expect(release.manifest.quality.pathExcursionAvailabilityRate).toBe(1);
    expect(release.dataset.rows).toHaveLength(1);
    expect(Object.keys(release.dataset.rows[0]?.features ?? {})).toHaveLength(
      ALPHA_FEATURE_NAMES.length,
    );
    expect(release.report.status).toBe('INSUFFICIENT_DATA');
    expect(release.report.productionFeaturesEnabled).toEqual([]);
    expect(persistedManifest).toEqual(release.manifest);
    expect(
      await createFileSha256(join(release.directory, 'alpha-dataset.json')),
    ).toBe(release.manifest.datasetFileSha256);
    expect(
      await createFileSha256(
        join(release.directory, 'alpha-research-report.json'),
      ),
    ).toBe(release.manifest.researchReportFileSha256);
    expect(await verifyEvidenceDatasetRelease(release.directory)).toMatchObject(
      { valid: true, reasons: [] },
    );
  });

  it('never overwrites an existing release with the same evidence', async () => {
    const { directory } = await setupEvaluation();
    const input = {
      evaluationId: EVALUATION_ID,
      evaluationDirectory: directory,
      createdAt: START + 86_400_000,
      sourceCommit: 'source-commit',
      gitStatus: '',
    } as const;
    const first = await createEvidenceDatasetRelease(input);

    await expect(
      createEvidenceDatasetRelease({
        ...input,
        createdAt: input.createdAt + 1,
      }),
    ).rejects.toThrow('Immutable dataset release already exists');
    expect(await readdir(join(directory, 'datasets'))).toEqual([
      first.manifest.releaseFingerprint,
    ]);
  });

  it('refuses incomplete evidence and removes its private staging directory', async () => {
    const { directory } = await setupEvaluation();
    await writeFile(join(directory, 'alpha-snapshots.ndjson'), '');

    await expect(
      createEvidenceDatasetRelease({
        evaluationId: EVALUATION_ID,
        evaluationDirectory: directory,
        createdAt: START + 86_400_000,
        sourceCommit: 'source-commit',
        gitStatus: '',
      }),
    ).rejects.toThrow('Evidence is not ready for final evaluation');
    expect(await readdir(join(directory, 'datasets'))).toEqual([]);
  });

  it('refuses finalization from a different or dirty checkout', async () => {
    const { directory } = await setupEvaluation();

    await expect(
      createEvidenceDatasetRelease({
        evaluationId: EVALUATION_ID,
        evaluationDirectory: directory,
        createdAt: START + 86_400_000,
        sourceCommit: 'different',
        gitStatus: '',
      }),
    ).rejects.toThrow('clean source commit');
  });

  it('cannot finalize while an evidence collector owns the evaluation', async () => {
    const { directory, manifest } = await setupEvaluation();
    const collectorLease = new EvidenceEvaluationLease({
      evaluationDirectory: directory,
      evaluationId: EVALUATION_ID,
      sourceCommit: manifest.sourceCommit,
      configurationFingerprint: manifest.configurationFingerprint,
      purpose: 'COLLECTION',
    });
    await collectorLease.acquire();

    try {
      await expect(
        createEvidenceDatasetRelease({
          evaluationId: EVALUATION_ID,
          evaluationDirectory: directory,
          createdAt: START + 86_400_000,
          sourceCommit: 'source-commit',
          gitStatus: '',
        }),
      ).rejects.toThrow('Another process owns this evidence evaluation');
    } finally {
      await collectorLease.release();
    }
  });

  it('detects corruption after a release has been created', async () => {
    const { directory } = await setupEvaluation();
    const release = await createEvidenceDatasetRelease({
      evaluationId: EVALUATION_ID,
      evaluationDirectory: directory,
      createdAt: START + 86_400_000,
      sourceCommit: 'source-commit',
      gitStatus: '',
    });
    await appendFile(
      join(release.directory, 'alpha-research-report.json'),
      '\n',
    );

    const verification = await verifyEvidenceDatasetRelease(release.directory);

    expect(verification.valid).toBe(false);
    expect(verification.reasons).toContain(
      'Research report hash does not match',
    );
  });
});
