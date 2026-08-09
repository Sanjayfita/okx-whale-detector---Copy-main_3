import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { AlphaResearchSnapshotRecorder } from '../src/research/alphaResearchSnapshotRecorder';
import {
  ALPHA_FIXTURE_EVALUATION_ID,
  createAlphaSnapshotFixture,
} from './AlphaResearchFixtures';

const setup = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'alpha-recorder-'));
  await writeFile(
    path.join(directory, 'manifest.json'),
    JSON.stringify({
      evaluationId: ALPHA_FIXTURE_EVALUATION_ID,
      sourceCommit: 'fixture',
      configurationFingerprint: 'alpha-fixture-config',
      liveOrderExecutionAllowed: false,
    }),
  );
  await writeFile(path.join(directory, 'alpha-snapshots.ndjson'), '');
  return directory;
};

describe('AlphaResearchSnapshotRecorder', () => {
  it('persists one validated, research-only event-time snapshot', async () => {
    const directory = await setup();
    const recorder = new AlphaResearchSnapshotRecorder({
      evaluationDirectory: directory,
    });
    await recorder.initialize();
    await recorder.record(createAlphaSnapshotFixture({ synthetic: false }));

    const content = await readFile(
      path.join(directory, 'alpha-snapshots.ndjson'),
      'utf8',
    );
    const parsed = JSON.parse(content.trim()) as Record<string, unknown>;
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.capturedFeatures).toMatchObject({
      schemaVersion: 1,
      featureRegistryVersion: 'alpha-feature-registry-v1',
      enabledFeatureCount: 50,
    });
    expect(parsed.synthetic).toBe(false);
    expect(parsed.liveOrderExecutionAllowed).toBe(false);
  });

  it('serializes concurrent writes and rejects duplicate alert IDs', async () => {
    const directory = await setup();
    const recorder = new AlphaResearchSnapshotRecorder({
      evaluationDirectory: directory,
    });
    await recorder.initialize();
    const snapshot = createAlphaSnapshotFixture({ synthetic: false });
    const results = await Promise.allSettled([
      recorder.record(snapshot),
      recorder.record(snapshot),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
  });

  it('rejects synthetic or future-informed snapshots', async () => {
    const directory = await setup();
    const recorder = new AlphaResearchSnapshotRecorder({
      evaluationDirectory: directory,
    });
    await recorder.initialize();
    await expect(recorder.record(createAlphaSnapshotFixture())).rejects.toThrow(
      'frozen evaluation',
    );

    const snapshot = createAlphaSnapshotFixture({ synthetic: false });
    await expect(
      recorder.record({
        ...snapshot,
        whale: {
          ...snapshot.whale,
          availabilityTimestamp: snapshot.evidence.detectedAt + 1,
        },
      }),
    ).rejects.toThrow('future information');
  });

  it('refuses malformed existing snapshot evidence', async () => {
    const directory = await setup();
    await writeFile(
      path.join(directory, 'alpha-snapshots.ndjson'),
      '{"schemaVersion":1}\n',
    );
    const recorder = new AlphaResearchSnapshotRecorder({
      evaluationDirectory: directory,
    });
    await expect(recorder.initialize()).rejects.toThrow('malformed records');
  });

  it('detects persisted feature values that no longer reproduce', async () => {
    const directory = await setup();
    const recorder = new AlphaResearchSnapshotRecorder({
      evaluationDirectory: directory,
    });
    await recorder.initialize();
    await recorder.record(createAlphaSnapshotFixture({ synthetic: false }));
    const pathName = path.join(directory, 'alpha-snapshots.ndjson');
    const persisted = JSON.parse((await readFile(pathName, 'utf8')).trim()) as {
      capturedFeatures: {
        values: Record<string, number | null>;
      };
    };
    persisted.capturedFeatures.values.spread_bps = 999;
    await writeFile(pathName, `${JSON.stringify(persisted)}\n`);

    await expect(
      new AlphaResearchSnapshotRecorder({
        evaluationDirectory: directory,
      }).initialize(),
    ).rejects.toThrow('do not reproduce');
  });
});
