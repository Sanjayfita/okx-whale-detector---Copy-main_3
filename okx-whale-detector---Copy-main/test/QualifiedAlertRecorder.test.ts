import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { QualifiedAlertRecorder } from '../src/research/qualifiedAlertRecorder';
import { createQualifiedAlertEvidenceRecord } from '../src/research/qualifiedAlertEvidence';

const setup = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'alert-recorder-'));
  await writeFile(
    path.join(directory, 'manifest.json'),
    JSON.stringify({
      evaluationId: 'eval-1',
      sourceCommit: 'abc123',
      configurationFingerprint: 'fingerprint',
      liveOrderExecutionAllowed: false,
    }),
  );
  await writeFile(path.join(directory, 'qualified-alerts.ndjson'), '');
  return directory;
};

const record = () =>
  createQualifiedAlertEvidenceRecord({
    evaluationId: 'eval-1',
    alertId: 'alert-1',
    instrumentId: 'BTC-USDT',
    detectedAt: 1_000,
    recordedAt: 1_001,
    direction: 'BULLISH',
    signalType: 'ABSORPTION',
    confidence: 80,
    referencePrice: 100,
    bestBid: 99.9,
    bestAsk: 100.1,
    spreadPercent: 0.2,
    sourceCommit: 'abc123',
    configurationFingerprint: 'fingerprint',
  });

describe('QualifiedAlertRecorder', () => {
  it('appends one valid NDJSON record', async () => {
    const directory = await setup();
    const recorder = new QualifiedAlertRecorder({
      evaluationDirectory: directory,
    });
    await recorder.initialize();
    await recorder.record(record());

    const lines = (
      await readFile(path.join(directory, 'qualified-alerts.ndjson'), 'utf8')
    )
      .trim()
      .split('\n');

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).alertId).toBe('alert-1');
  });

  it('requires initialization', async () => {
    const directory = await setup();
    const recorder = new QualifiedAlertRecorder({
      evaluationDirectory: directory,
    });
    await expect(recorder.record(record())).rejects.toThrow(
      'initialized first',
    );
  });

  it('rejects records from another frozen evaluation', async () => {
    const directory = await setup();
    const recorder = new QualifiedAlertRecorder({
      evaluationDirectory: directory,
    });
    await recorder.initialize();

    await expect(
      recorder.record({ ...record(), evaluationId: 'other-evaluation' }),
    ).rejects.toThrow('does not match the frozen evaluation');
  });

  it('rejects duplicate alert IDs even when writes are concurrent', async () => {
    const directory = await setup();
    const recorder = new QualifiedAlertRecorder({
      evaluationDirectory: directory,
    });
    await recorder.initialize();

    const results = await Promise.allSettled([
      recorder.record(record()),
      recorder.record(record()),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(
      (await readFile(path.join(directory, 'qualified-alerts.ndjson'), 'utf8'))
        .trim()
        .split('\n'),
    ).toHaveLength(1);
  });

  it('rejects malformed existing evidence during initialization', async () => {
    const directory = await setup();
    await writeFile(
      path.join(directory, 'qualified-alerts.ndjson'),
      '{"alertId":"not-a-complete-record"}\n',
    );
    const recorder = new QualifiedAlertRecorder({
      evaluationDirectory: directory,
    });

    await expect(recorder.initialize()).rejects.toThrow('malformed records');
  });
});
