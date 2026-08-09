import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  generateAlphaResearchBundle,
  generateAlphaResearchReport,
} from '../src/tools/runAlphaResearch';
import {
  ALPHA_FIXTURE_EVALUATION_ID,
  createAlphaOutcomeFixture,
  createAlphaSnapshotFixture,
} from './AlphaResearchFixtures';

const setup = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'alpha-cli-'));
  const snapshot = createAlphaSnapshotFixture();
  const outcome = createAlphaOutcomeFixture({ snapshot });
  await writeFile(
    path.join(directory, 'qualified-alerts.ndjson'),
    `${JSON.stringify(snapshot.evidence)}\n`,
  );
  await writeFile(
    path.join(directory, 'alpha-snapshots.ndjson'),
    `${JSON.stringify(snapshot)}\n`,
  );
  await writeFile(
    path.join(directory, 'outcomes.ndjson'),
    `${JSON.stringify(outcome)}\n`,
  );
  return directory;
};

describe('alpha research command', () => {
  it('loads versioned snapshots and reports insufficient synthetic evidence', async () => {
    const directory = await setup();
    const report = await generateAlphaResearchReport({
      evaluationId: ALPHA_FIXTURE_EVALUATION_ID,
      evaluationDirectory: directory,
    });

    expect(report.status).toBe('NO_EMPIRICAL_DATA');
    expect(report.totalRows).toBe(1);
    expect(report.inputAlertCount).toBe(1);
    expect(report.missingSnapshots).toBe(0);
    expect(report.schemaVersion).toBe(2);
    expect(report.configurationFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(report.datasetFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(report.productionFeaturesEnabled).toEqual([]);
  });

  it('generates feature and confidence reports from one immutable dataset', async () => {
    const directory = await setup();
    const bundle = await generateAlphaResearchBundle({
      evaluationId: ALPHA_FIXTURE_EVALUATION_ID,
      evaluationDirectory: directory,
    });

    expect(bundle.alphaReport.status).toBe('NO_EMPIRICAL_DATA');
    expect(bundle.confidenceReport.status).toBe('NO_EMPIRICAL_DATA');
    expect(bundle.confidenceReport.datasetFingerprint).toBe(
      bundle.alphaReport.datasetFingerprint,
    );
    expect(bundle.confidenceReport.productionEnabled).toBe(false);
    expect(bundle.confidenceReport.liveOrderExecutionAllowed).toBe(false);
  });

  it('fails closed when an input line is malformed', async () => {
    const directory = await setup();
    await writeFile(
      path.join(directory, 'alpha-snapshots.ndjson'),
      '{"invalid":true}\n',
    );
    await expect(
      generateAlphaResearchReport({
        evaluationId: ALPHA_FIXTURE_EVALUATION_ID,
        evaluationDirectory: directory,
      }),
    ).rejects.toThrow('Malformed alpha inputs');
  });
});
