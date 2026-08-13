import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createEvidenceAlertSessionId,
  loadEvidenceInitialAlertSequence,
} from '../src/research/evidenceAlertIdentity';
import { createQualifiedAlertEvidenceRecord } from '../src/research/qualifiedAlertEvidence';

const evidence = (sessionId: string, sequence: number) =>
  createQualifiedAlertEvidenceRecord({
    evaluationId: 'eval-restart',
    alertId: `correlated-alert:${sessionId}:${sequence}`,
    instrumentId: 'BTC-USDT-SWAP',
    instrumentType: 'SWAP',
    detectedAt: 1_000 + sequence,
    recordedAt: 1_000 + sequence,
    direction: 'BULLISH',
    signalType: 'TEST',
    confidence: 80,
    referencePrice: 100,
    bestBid: 99.9,
    bestAsk: 100.1,
    spreadPercent: 0.2,
    sourceCommit: 'abc',
    configurationFingerprint: 'cfg',
  });

describe('evidence alert runtime identity', () => {
  it('derives the same URL-safe session id for the same evaluation', () => {
    const first = createEvidenceAlertSessionId('forward-30d-eval');
    const second = createEvidenceAlertSessionId('forward-30d-eval');
    expect(first).toBe(second);
    expect(first).toMatch(/^evidence-[a-f0-9]{32}$/u);
  });

  it('continues the persisted alert sequence after restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'evidence-alert-id-'));
    const sessionId = createEvidenceAlertSessionId('eval-restart');
    await writeFile(
      join(directory, 'qualified-alerts.ndjson'),
      `${JSON.stringify(evidence(sessionId, 1))}\n${JSON.stringify(evidence(sessionId, 7))}\n`,
    );
    await expect(
      loadEvidenceInitialAlertSequence(directory, sessionId),
    ).resolves.toBe(7);
  });
});
