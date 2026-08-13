import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { EvidenceCoverageGapStore } from '../src/research/evidenceCoverageGap';
import { EvidenceQuarantineStore } from '../src/research/evidenceQuarantine';
import { LiveEvidenceCollector } from '../src/research/liveEvidenceCollector';
import { PersistentOutcomeScheduler } from '../src/research/persistentOutcomeScheduler';
import { QualifiedAlertRecorder } from '../src/research/qualifiedAlertRecorder';
import { createQualifiedAlertEvidenceRecord } from '../src/research/qualifiedAlertEvidence';

const createDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'evidence-quarantine-'));
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({ evaluationId: 'q-eval', sourceCommit: 'abc', configurationFingerprint: 'cfg', liveOrderExecutionAllowed: false }));
  for (const name of ['qualified-alerts.ndjson','outcomes.ndjson','quarantined-episodes.ndjson','coverage-gaps.ndjson']) await writeFile(join(directory, name), '');
  await writeFile(join(directory, 'pending-observations.json'), JSON.stringify({ schemaVersion: 1, pending: [], liveOrderExecutionAllowed: false }));
  return directory;
};

const evidence = (alertId: string, detectedAt: number) => createQualifiedAlertEvidenceRecord({
  evaluationId: 'q-eval', alertId, instrumentId: 'BTC-USDT-SWAP', instrumentType: 'SWAP', detectedAt, recordedAt: detectedAt,
  direction: 'BULLISH', signalType: 'TEST', confidence: 80, referencePrice: 100, bestBid: 99.9, bestAsk: 100.1,
  spreadPercent: 0.2, sourceCommit: 'abc', configurationFingerprint: 'cfg',
});

describe('quarantine-and-continue evidence semantics', () => {
  it('quarantines an expired episode and continues collecting unrelated future episodes', async () => {
    const directory = await createDirectory();
    const scheduler = new PersistentOutcomeScheduler(directory, [0.08333333333333333, 0.25]);
    const quarantineStore = new EvidenceQuarantineStore(directory);
    const gapStore = new EvidenceCoverageGapStore(directory);
    const collector = new LiveEvidenceCollector({
      recorder: new QualifiedAlertRecorder({ evaluationDirectory: directory }), scheduler, quarantineStore, coverageGapStore: gapStore,
      maximumObservationDelayMs: 1_000,
      readPrice: async (instrumentId, dueAt) => ({ instrumentId, observedAt: dueAt, sourceMarketTimestamp: dueAt, sourceMarketAgeMs: 0, sourceMarketDataSource: 'OKX_ORDER_BOOK_WEBSOCKET_MIDPOINT', price: 101 }),
    });
    await collector.initialize();
    await collector.recordQualifiedAlert(evidence('alert-bad', 1_000));
    expect(await collector.processDueObservations(7_001)).toBe(0);
    expect(quarantineStore.isQuarantined('alert-bad')).toBe(true);
    expect(scheduler.getPendingJobs().filter((job) => job.alertId === 'alert-bad')).toHaveLength(0);

    await collector.recordQualifiedAlert(evidence('alert-good', 10_000));
    expect(await collector.processDueObservations(15_000)).toBe(1);
    expect(quarantineStore.isQuarantined('alert-good')).toBe(false);
    const outcomes = await readFile(join(directory, 'outcomes.ndjson'), 'utf8');
    expect(outcomes).toContain('"alertId":"alert-good"');
    expect(outcomes).not.toContain('"alertId":"alert-bad"');
    const gaps = await readFile(join(directory, 'coverage-gaps.ndjson'), 'utf8');
    expect(gaps).toContain('OBSERVATION_WINDOW_EXPIRED');
  });

  it('does not recreate pending jobs for quarantined alerts after restart', async () => {
    const directory = await createDirectory();
    const quarantineStore = new EvidenceQuarantineStore(directory);
    const scheduler = new PersistentOutcomeScheduler(directory, [0.08333333333333333]);
    const collector = new LiveEvidenceCollector({
      recorder: new QualifiedAlertRecorder({ evaluationDirectory: directory }), scheduler, quarantineStore, coverageGapStore: new EvidenceCoverageGapStore(directory), maximumObservationDelayMs: 0,
      readPrice: async () => { throw new Error('not used'); },
    });
    await collector.initialize();
    await collector.recordQualifiedAlert(evidence('alert-1', 1_000));
    await collector.processDueObservations(6_001);

    const recoveredQuarantine = new EvidenceQuarantineStore(directory);
    await recoveredQuarantine.initialize();
    const recovered = new PersistentOutcomeScheduler(directory, [0.08333333333333333]);
    recovered.setQuarantinedAlertIds(recoveredQuarantine.getAll().map((row) => row.alertId));
    await recovered.initialize();
    expect(recovered.getPendingJobs()).toHaveLength(0);
  });
});
