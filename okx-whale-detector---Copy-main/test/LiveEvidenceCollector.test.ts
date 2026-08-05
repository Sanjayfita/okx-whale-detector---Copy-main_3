import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  createQualifiedAlertEvidenceRecord,
  type QualifiedAlertEvidenceRecord,
} from '../src/research/qualifiedAlertEvidence';
import { LiveEvidenceCollector } from '../src/research/liveEvidenceCollector';
import { PersistentOutcomeScheduler } from '../src/research/persistentOutcomeScheduler';
import { QualifiedAlertRecorder } from '../src/research/qualifiedAlertRecorder';

const createEvaluationDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'live-evidence-'));
  await writeFile(
    join(directory, 'manifest.json'),
    JSON.stringify({
      evaluationId: 'evaluation-1',
      sourceCommit: 'abc123',
      configurationFingerprint: 'fingerprint-1',
      liveOrderExecutionAllowed: false,
    }),
    'utf8',
  );
  await writeFile(join(directory, 'qualified-alerts.ndjson'), '', 'utf8');
  await writeFile(join(directory, 'outcomes.ndjson'), '', 'utf8');
  await writeFile(join(directory, 'pending-observations.json'), '[]', 'utf8');
  return directory;
};

const createEvidence = (
  overrides: Partial<QualifiedAlertEvidenceRecord> = {},
) =>
  createQualifiedAlertEvidenceRecord({
    evaluationId: overrides.evaluationId ?? 'evaluation-1',
    alertId: overrides.alertId ?? 'alert-1',
    instrumentId: overrides.instrumentId ?? 'BTC-USDT',
    detectedAt: overrides.detectedAt ?? 1_000,
    recordedAt: overrides.recordedAt ?? 1_001,
    direction: overrides.direction ?? 'BULLISH',
    signalType: overrides.signalType ?? 'ABSORPTION',
    confidence: overrides.confidence ?? 80,
    referencePrice: overrides.referencePrice ?? 100,
    bestBid: overrides.bestBid ?? 99.9,
    bestAsk: overrides.bestAsk ?? 100.1,
    spreadPercent: overrides.spreadPercent ?? 0.2,
    sourceCommit: overrides.sourceCommit ?? 'abc123',
    configurationFingerprint:
      overrides.configurationFingerprint ?? 'fingerprint-1',
  });

describe('LiveEvidenceCollector', () => {
  it('records an alert, schedules horizons, and completes due observations', async () => {
    const directory = await createEvaluationDirectory();
    const scheduler = new PersistentOutcomeScheduler(directory);
    const collector = new LiveEvidenceCollector({
      recorder: new QualifiedAlertRecorder({ evaluationDirectory: directory }),
      scheduler,
      readPrice: async (instrumentId, dueAt) => ({
        instrumentId,
        observedAt: dueAt,
        price: 101,
        maximumFavorableExcursionPercent: 1.5,
        maximumAdverseExcursionPercent: 0.4,
        excursionMeasurement: 'OBSERVED_PATH',
      }),
    });

    await collector.initialize();
    await collector.recordQualifiedAlert(createEvidence());

    expect(scheduler.getPendingJobs()).toHaveLength(5);
    expect(await collector.processDueObservations(61_000)).toBe(1);
    expect(scheduler.getPendingJobs()).toHaveLength(4);

    const alerts = await readFile(
      join(directory, 'qualified-alerts.ndjson'),
      'utf8',
    );
    const outcomes = await readFile(join(directory, 'outcomes.ndjson'), 'utf8');
    expect(alerts).toContain('"alertId":"alert-1"');
    expect(outcomes).toContain('"horizonMinutes":1');
    expect(outcomes).toContain('"directionAdjustedReturnPercent":1');
    expect(outcomes).toContain('"excursionMeasurement":"OBSERVED_PATH"');
  });

  it('requires initialization before collecting evidence', async () => {
    const directory = await createEvaluationDirectory();
    const collector = new LiveEvidenceCollector({
      recorder: new QualifiedAlertRecorder({ evaluationDirectory: directory }),
      scheduler: new PersistentOutcomeScheduler(directory),
      readPrice: async () => {
        throw new Error('not used');
      },
    });

    await expect(
      collector.recordQualifiedAlert(createEvidence()),
    ).rejects.toThrow('must be initialized first');
  });

  it('keeps an expired job pending without repeated ticker calls or logs', async () => {
    const directory = await createEvaluationDirectory();
    const scheduler = new PersistentOutcomeScheduler(directory);
    const onObservationError = vi.fn();
    const readPrice = vi.fn(async () => {
      throw new Error('expired jobs must not call the ticker');
    });
    const collector = new LiveEvidenceCollector({
      recorder: new QualifiedAlertRecorder({ evaluationDirectory: directory }),
      scheduler,
      maximumObservationDelayMs: 1_000,
      onObservationError,
      readPrice,
    });

    await collector.initialize();
    await collector.recordQualifiedAlert(createEvidence());

    expect(await collector.processDueObservations(62_001)).toBe(0);
    expect(await collector.processDueObservations(63_000)).toBe(0);
    expect(readPrice).not.toHaveBeenCalled();
    expect(onObservationError).toHaveBeenCalledOnce();
    expect(onObservationError.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ message: expect.stringContaining('expired') }),
    );
    expect(scheduler.getPendingJobs()).toHaveLength(5);
  });

  it('continues processing unrelated instruments after one ticker fails', async () => {
    const directory = await createEvaluationDirectory();
    const scheduler = new PersistentOutcomeScheduler(directory);
    const onObservationError = vi.fn();
    const collector = new LiveEvidenceCollector({
      recorder: new QualifiedAlertRecorder({ evaluationDirectory: directory }),
      scheduler,
      onObservationError,
      readPrice: async (instrumentId, dueAt) => {
        if (instrumentId === 'BTC-USDT') {
          throw new Error('temporary BTC ticker failure');
        }
        return {
          instrumentId,
          observedAt: dueAt,
          price: 101,
          maximumFavorableExcursionPercent: 0,
          maximumAdverseExcursionPercent: 0,
          excursionMeasurement: 'UNAVAILABLE',
        };
      },
    });

    await collector.initialize();
    await collector.recordQualifiedAlert(createEvidence());
    await collector.recordQualifiedAlert(
      createEvidence({ alertId: 'alert-2', instrumentId: 'ETH-USDT' }),
    );

    expect(await collector.processDueObservations(61_000)).toBe(1);
    expect(onObservationError).toHaveBeenCalledOnce();
    expect(scheduler.getPendingJobs()).toHaveLength(9);

    const outcomes = await readFile(join(directory, 'outcomes.ndjson'), 'utf8');
    expect(outcomes).toContain('"alertId":"alert-2"');
    expect(outcomes).not.toContain('"alertId":"alert-1"');
  });

  it('shares one ticker snapshot across same-instrument due jobs', async () => {
    const directory = await createEvaluationDirectory();
    const scheduler = new PersistentOutcomeScheduler(directory);
    const readPrice = vi.fn(async (instrumentId: string, dueAt: number) => ({
      instrumentId,
      observedAt: dueAt,
      price: 101,
      maximumFavorableExcursionPercent: 0,
      maximumAdverseExcursionPercent: 0,
      excursionMeasurement: 'UNAVAILABLE' as const,
    }));
    const collector = new LiveEvidenceCollector({
      recorder: new QualifiedAlertRecorder({ evaluationDirectory: directory }),
      scheduler,
      readPrice,
    });

    await collector.initialize();
    await collector.recordQualifiedAlert(createEvidence());
    await collector.recordQualifiedAlert(createEvidence({ alertId: 'alert-2' }));

    expect(await collector.processDueObservations(61_000)).toBe(2);
    expect(readPrice).toHaveBeenCalledOnce();
    expect(readPrice).toHaveBeenCalledWith('BTC-USDT', 61_000);
    expect(scheduler.getPendingJobs()).toHaveLength(8);
  });

  it('validates exchange timestamps against request completion time', async () => {
    const directory = await createEvaluationDirectory();
    const scheduler = new PersistentOutcomeScheduler(directory);
    let clockNow = 61_000;
    const collector = new LiveEvidenceCollector({
      recorder: new QualifiedAlertRecorder({ evaluationDirectory: directory }),
      scheduler,
      clock: () => clockNow,
      maximumObservationDelayMs: 10_000,
      maximumFutureSkewMs: 0,
      readPrice: async (instrumentId) => {
        clockNow = 66_000;
        return {
          instrumentId,
          observedAt: 66_000,
          price: 101,
          maximumFavorableExcursionPercent: 0,
          maximumAdverseExcursionPercent: 0,
          excursionMeasurement: 'UNAVAILABLE',
        };
      },
    });

    await collector.initialize();
    await collector.recordQualifiedAlert(createEvidence());

    expect(await collector.processDueObservations(61_000)).toBe(1);
    expect(scheduler.getPendingJobs()).toHaveLength(4);
  });
});
