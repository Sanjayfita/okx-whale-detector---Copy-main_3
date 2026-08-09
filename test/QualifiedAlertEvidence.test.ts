import { describe, expect, it } from 'vitest';

import { createQualifiedAlertEvidenceRecord } from '../src/research/qualifiedAlertEvidence';

const validInput = () => ({
  evaluationId: 'eval-2026-08',
  alertId: 'alert-1',
  instrumentId: 'BTC-USDT',
  detectedAt: 1_000,
  recordedAt: 1_010,
  direction: 'BULLISH' as const,
  signalType: 'WHALE_ABSORPTION',
  confidence: 82,
  referencePrice: 100,
  bestBid: 99.9,
  bestAsk: 100.1,
  spreadPercent: 0.2,
  sourceCommit: '314a72a',
  configurationFingerprint: 'config-sha256',
});

describe('createQualifiedAlertEvidenceRecord', () => {
  it('creates an immutable qualified evidence record', () => {
    const record = createQualifiedAlertEvidenceRecord(validInput());

    expect(record.schemaVersion).toBe(1);
    expect(record.qualified).toBe(true);
    expect(record.liveOrderExecutionAllowed).toBe(false);
    expect(Object.isFrozen(record)).toBe(true);
  });

  it('rejects recording timestamps before detection', () => {
    expect(() =>
      createQualifiedAlertEvidenceRecord({
        ...validInput(),
        recordedAt: 999,
      }),
    ).toThrow('recordedAt cannot be earlier than detectedAt');
  });

  it('rejects confidence outside zero to one hundred', () => {
    expect(() =>
      createQualifiedAlertEvidenceRecord({
        ...validInput(),
        confidence: 101,
      }),
    ).toThrow('confidence must be between 0 and 100');
  });

  it('rejects empty identifiers and invalid market prices', () => {
    expect(() =>
      createQualifiedAlertEvidenceRecord({
        ...validInput(),
        alertId: ' ',
      }),
    ).toThrow('alertId must not be empty');

    expect(() =>
      createQualifiedAlertEvidenceRecord({
        ...validInput(),
        bestAsk: 0,
      }),
    ).toThrow('bestAsk must be a positive finite number');
  });

  it('rejects non-directional alerts and invalid spread evidence', () => {
    expect(() =>
      createQualifiedAlertEvidenceRecord({
        ...validInput(),
        direction: 'NEUTRAL',
      }),
    ).toThrow('direction must be BULLISH or BEARISH');

    expect(() =>
      createQualifiedAlertEvidenceRecord({
        ...validInput(),
        bestBid: 100.2,
      }),
    ).toThrow('bestBid must be lower than bestAsk');

    expect(() =>
      createQualifiedAlertEvidenceRecord({
        ...validInput(),
        spreadPercent: 99,
      }),
    ).toThrow('spreadPercent does not match');
  });
});
