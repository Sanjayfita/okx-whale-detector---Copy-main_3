import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createAlertOutcomeObservation } from '../src/research/alertOutcomeObservation';
import { createQualifiedAlertEvidenceRecord } from '../src/research/qualifiedAlertEvidence';
import { PersistentOutcomeScheduler } from '../src/research/persistentOutcomeScheduler';

const makeEvidence = () =>
  createQualifiedAlertEvidenceRecord({
    evaluationId: 'eval-r2',
    alertId: 'alert-1',
    instrumentId: 'BTC-USDT',
    detectedAt: 1_000_000,
    recordedAt: 1_000_100,
    direction: 'BULLISH',
    signalType: 'ABSORPTION',
    confidence: 90,
    referencePrice: 100,
    bestBid: 99.9,
    bestAsk: 100.1,
    spreadPercent: 0.2,
    sourceCommit: 'abc123',
    configurationFingerprint: 'fingerprint',
    qualified: true,
  });

const makeDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'outcome-scheduler-'));
  await writeFile(join(directory, 'qualified-alerts.ndjson'), '', 'utf8');
  await writeFile(join(directory, 'pending-observations.json'), '[]\n', 'utf8');
  await writeFile(join(directory, 'outcomes.ndjson'), '', 'utf8');
  return directory;
};

describe('PersistentOutcomeScheduler', () => {
  it('creates exactly five persistent horizon jobs in chronological order', async () => {
    const directory = await makeDirectory();
    const scheduler = new PersistentOutcomeScheduler(directory);
    await scheduler.initialize();

    const created = await scheduler.scheduleAlert(makeEvidence());

    expect(created.map((job) => job.horizonMinutes)).toEqual([
      1, 5, 15, 30, 60,
    ]);
    expect(scheduler.getPendingJobs()).toHaveLength(5);
    expect(scheduler.getPendingJobs()[0]?.dueAt).toBe(1_060_000);

    const persisted = JSON.parse(
      await readFile(join(directory, 'pending-observations.json'), 'utf8'),
    ) as { pending: unknown[] };
    expect(persisted.pending).toHaveLength(5);
  });

  it('is idempotent when the same alert is scheduled twice', async () => {
    const scheduler = new PersistentOutcomeScheduler(await makeDirectory());
    await scheduler.initialize();
    await scheduler.scheduleAlert(makeEvidence());

    const duplicateJobs = await scheduler.scheduleAlert(makeEvidence());

    expect(duplicateJobs).toHaveLength(0);
    expect(scheduler.getPendingJobs()).toHaveLength(5);
  });

  it('schedules only the horizons frozen for the evaluation', async () => {
    const scheduler = new PersistentOutcomeScheduler(
      await makeDirectory(),
      [5, 15],
    );
    await scheduler.initialize();

    const created = await scheduler.scheduleAlert(makeEvidence());

    expect(created.map((job) => job.horizonMinutes)).toEqual([5, 15]);
    expect(scheduler.getPendingJobs()).toHaveLength(2);
  });

  it('serializes concurrent scheduling of the same alert', async () => {
    const scheduler = new PersistentOutcomeScheduler(await makeDirectory());
    await scheduler.initialize();

    const [first, second] = await Promise.all([
      scheduler.scheduleAlert(makeEvidence()),
      scheduler.scheduleAlert(makeEvidence()),
    ]);

    expect(first.length + second.length).toBe(5);
    expect(scheduler.getPendingJobs()).toHaveLength(5);
  });

  it('recovers pending jobs after a restart and returns only due jobs', async () => {
    const directory = await makeDirectory();
    const first = new PersistentOutcomeScheduler(directory);
    await first.initialize();
    await first.scheduleAlert(makeEvidence());

    const recovered = new PersistentOutcomeScheduler(directory);
    await recovered.initialize();

    expect(recovered.getPendingJobs()).toHaveLength(5);
    expect(recovered.getDueJobs(1_059_999)).toHaveLength(0);
    expect(
      recovered.getDueJobs(1_060_000).map((job) => job.horizonMinutes),
    ).toEqual([1]);
  });

  it('reconstructs jobs when a crash occurs after the alert append', async () => {
    const directory = await makeDirectory();
    await writeFile(
      join(directory, 'qualified-alerts.ndjson'),
      `${JSON.stringify(makeEvidence())}\n`,
      'utf8',
    );

    const recovered = new PersistentOutcomeScheduler(directory);
    await recovered.initialize();

    expect(recovered.getPendingJobs()).toHaveLength(5);
    expect(recovered.getLastReconciliation()).toEqual({
      addedMissingJobs: 5,
      removedCompletedJobs: 0,
      unchangedJobs: 0,
    });
  });

  it('removes an already appended outcome after a crash before state persistence', async () => {
    const directory = await makeDirectory();
    const evidence = makeEvidence();
    await writeFile(
      join(directory, 'qualified-alerts.ndjson'),
      `${JSON.stringify(evidence)}\n`,
      'utf8',
    );
    const scheduler = new PersistentOutcomeScheduler(directory);
    await scheduler.initialize();
    const persistedBeforeCompletion = await readFile(
      join(directory, 'pending-observations.json'),
      'utf8',
    );
    const observation = createAlertOutcomeObservation({
      evaluationId: evidence.evaluationId,
      alertId: evidence.alertId,
      instrumentId: evidence.instrumentId,
      detectedAt: evidence.detectedAt,
      horizonMinutes: 1,
      observedAt: evidence.detectedAt + 60_000,
      referencePrice: evidence.referencePrice,
      observedPrice: 101,
      rawReturnPercent: 1,
      directionAdjustedReturnPercent: 1,
      maximumFavorableExcursionPercent: 1,
      maximumAdverseExcursionPercent: 0,
    });
    await writeFile(
      join(directory, 'outcomes.ndjson'),
      `${JSON.stringify(observation)}\n`,
      'utf8',
    );
    await writeFile(
      join(directory, 'pending-observations.json'),
      persistedBeforeCompletion,
      'utf8',
    );

    const recovered = new PersistentOutcomeScheduler(directory);
    await recovered.initialize();

    expect(recovered.getPendingJobs()).toHaveLength(4);
    expect(recovered.getLastReconciliation()).toEqual({
      addedMissingJobs: 0,
      removedCompletedJobs: 1,
      unchangedJobs: 4,
    });
  });

  it('appends a completed observation and removes its pending job', async () => {
    const directory = await makeDirectory();
    const scheduler = new PersistentOutcomeScheduler(directory);
    await scheduler.initialize();
    await scheduler.scheduleAlert(makeEvidence());

    const observation = createAlertOutcomeObservation({
      evaluationId: 'eval-r2',
      alertId: 'alert-1',
      instrumentId: 'BTC-USDT',
      detectedAt: 1_000_000,
      horizonMinutes: 1,
      observedAt: 1_060_000,
      referencePrice: 100,
      observedPrice: 101,
      rawReturnPercent: 1,
      directionAdjustedReturnPercent: 1,
      maximumFavorableExcursionPercent: 1.2,
      maximumAdverseExcursionPercent: 0.3,
    });

    await scheduler.completeObservation(observation);

    expect(scheduler.getPendingJobs()).toHaveLength(4);
    expect(
      await readFile(join(directory, 'outcomes.ndjson'), 'utf8'),
    ).toContain('"horizonMinutes":1');
  });

  it('rejects an observation without a matching pending job', async () => {
    const scheduler = new PersistentOutcomeScheduler(await makeDirectory());
    await scheduler.initialize();

    const observation = createAlertOutcomeObservation({
      evaluationId: 'eval-r2',
      alertId: 'missing',
      instrumentId: 'BTC-USDT',
      detectedAt: 1_000_000,
      horizonMinutes: 1,
      observedAt: 1_060_000,
      referencePrice: 100,
      observedPrice: 101,
      rawReturnPercent: 1,
      directionAdjustedReturnPercent: 1,
      maximumFavorableExcursionPercent: 1,
      maximumAdverseExcursionPercent: 0,
    });

    await expect(scheduler.completeObservation(observation)).rejects.toThrow(
      'No matching pending observation job exists',
    );
  });

  it('rejects duplicate or malformed persisted jobs during recovery', async () => {
    const directory = await makeDirectory();
    const scheduler = new PersistentOutcomeScheduler(directory);
    await scheduler.initialize();
    await scheduler.scheduleAlert(makeEvidence());

    const pendingPath = join(directory, 'pending-observations.json');
    const persisted = JSON.parse(await readFile(pendingPath, 'utf8')) as {
      pending: unknown[];
    };
    await writeFile(
      pendingPath,
      JSON.stringify({
        schemaVersion: 1,
        pending: [persisted.pending[0], persisted.pending[0]],
        liveOrderExecutionAllowed: false,
      }),
      'utf8',
    );

    await expect(
      new PersistentOutcomeScheduler(directory).initialize(),
    ).rejects.toThrow('duplicate jobs');

    const persistedJob = persisted.pending[0];
    if (typeof persistedJob !== 'object' || persistedJob === null) {
      throw new Error('Expected a persisted pending job');
    }
    await writeFile(
      pendingPath,
      JSON.stringify({
        schemaVersion: 1,
        pending: [{ ...persistedJob, referencePrice: -1 }],
        liveOrderExecutionAllowed: false,
      }),
      'utf8',
    );

    await expect(
      new PersistentOutcomeScheduler(directory).initialize(),
    ).rejects.toThrow('Invalid pending outcome job');
  });

  it('rejects a return whose direction conflicts with its scheduled alert', async () => {
    const scheduler = new PersistentOutcomeScheduler(await makeDirectory());
    await scheduler.initialize();
    await scheduler.scheduleAlert(makeEvidence());

    const observation = createAlertOutcomeObservation({
      evaluationId: 'eval-r2',
      alertId: 'alert-1',
      instrumentId: 'BTC-USDT',
      detectedAt: 1_000_000,
      horizonMinutes: 1,
      observedAt: 1_060_000,
      referencePrice: 100,
      observedPrice: 101,
      rawReturnPercent: 1,
      directionAdjustedReturnPercent: -1,
      maximumFavorableExcursionPercent: 1,
      maximumAdverseExcursionPercent: 0,
    });

    await expect(scheduler.completeObservation(observation)).rejects.toThrow(
      'direction does not match',
    );
  });
});
