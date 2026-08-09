import { describe, expect, it } from 'vitest';

import { parseExternalSignalRecord } from '../src/external/recording/ExternalSignalRecording';

const validRecord = {
  type: 'externalSignal',
  recordedAt: 1_200,
  signal: {
    id: 'signal-1',
    underlyingEventId: 'tx:abc',
    provider: 'WHALE_ALERT',
    category: 'EXCHANGE_INFLOW',
    direction: 'BEARISH',
    occurredAt: 1_000,
    receivedAt: 1_100,
    confidence: 70,
    asset: 'BTC',
    description: 'BTC moved to an exchange',
    evidence: [
      {
        provider: 'WHALE_ALERT',
        providerEventId: 'wa-1',
        receivedAt: 1_100,
      },
    ],
  },
};

describe('external signal recording', () => {
  it('parses a valid external signal record', () => {
    const parsed = parseExternalSignalRecord(JSON.stringify(validRecord));

    expect(parsed.signal.underlyingEventId).toBe('tx:abc');
    expect(parsed.signal.provider).toBe('WHALE_ALERT');
  });

  it('rejects an invalid record type', () => {
    expect(() =>
      parseExternalSignalRecord(
        JSON.stringify({ ...validRecord, type: 'orderBook' }),
      ),
    ).toThrow('record type');
  });

  it('rejects an incomplete signal', () => {
    expect(() =>
      parseExternalSignalRecord(
        JSON.stringify({
          ...validRecord,
          signal: { id: 'signal-1' },
        }),
      ),
    ).toThrow('external whale signal');
  });
});
