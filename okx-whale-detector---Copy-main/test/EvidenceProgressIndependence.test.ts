import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createEvaluationSessionManifest } from '../src/research/evaluationSessionManifest';
import { inspectEvidenceProgress } from '../src/research/evidenceProgressInspector';
import { createQualifiedAlertEvidenceRecord } from '../src/research/qualifiedAlertEvidence';

const START = 1_800_000_000_000;

const createAlert = (
  manifest: ReturnType<typeof createEvaluationSessionManifest>,
  alertId: string,
  detectedAt: number,
) =>
  createQualifiedAlertEvidenceRecord({
    evaluationId: manifest.evaluationId,
    alertId,
    instrumentId: 'BTC-USDT',
    detectedAt,
    recordedAt: detectedAt,
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

describe('evidence readiness independence', () => {
  it('does not satisfy the alert target with overlapping same-instrument windows', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'evidence-independence-'));
    const manifest = createEvaluationSessionManifest({
      evaluationId: 'eval-independent',
      sourceCommit: 'abc123',
      configuration: {},
      instruments: ['BTC-USDT'],
      horizonsMinutes: [1, 5, 15, 30, 60],
      minimumCollectionDays: 1,
      minimumQualifiedAlerts: 2,
      minimumInstruments: 1,
      createdAt: START,
    });
    const alerts = [
      createAlert(manifest, 'alert-1', START + 1_000),
      createAlert(manifest, 'alert-2', START + 30 * 60_000),
    ];

    await writeFile(
      join(directory, 'manifest.json'),
      `${JSON.stringify(manifest)}\n`,
      'utf8',
    );
    await writeFile(
      join(directory, 'qualified-alerts.ndjson'),
      `${alerts.map((alert) => JSON.stringify(alert)).join('\n')}\n`,
      'utf8',
    );
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

    const report = await inspectEvidenceProgress(
      directory,
      START + 86_400_000,
    );

    expect(report.qualifiedAlertCount).toBe(2);
    expect(report.independentAlertCount).toBe(1);
    expect(report.dependentAlertCount).toBe(1);
    expect(report.maximumOutcomeHorizonMinutes).toBe(60);
    expect(report.alertRequirementMet).toBe(false);
    expect(report.readyForFinalEvaluation).toBe(false);
  });
});
