import { describe, expect, it } from 'vitest';

import { ExternalSignalStore } from '../src/external/core/ExternalSignalStore';
import type { ExternalWhaleSignal } from '../src/external/types/ExternalWhaleSignal';

const createSignal = (
  overrides: Partial<ExternalWhaleSignal> = {},
): ExternalWhaleSignal => ({
  id: 'signal-1',
  underlyingEventId: 'tx:abc',
  provider: 'WHALE_ALERT',
  category: 'EXCHANGE_INFLOW',
  direction: 'BEARISH',
  occurredAt: 1_000,
  receivedAt: 1_100,
  confidence: 60,
  asset: 'BTC',
  notionalUsd: 10_000_000,
  transactionHash: 'abc',
  description: 'BTC moved to an exchange',
  evidence: [
    {
      provider: 'WHALE_ALERT',
      providerEventId: 'wa-1',
      receivedAt: 1_100,
    },
  ],
  ...overrides,
});

describe('ExternalSignalStore', () => {
  it('stores and retrieves signals by asset', () => {
    const store = new ExternalSignalStore({ retentionMs: 10_000 });
    store.add(createSignal(), 1_200);

    expect(store.getByAsset('btc', 1_200)).toHaveLength(1);
  });

  it('merges provider evidence for the same underlying event', () => {
    const store = new ExternalSignalStore({ retentionMs: 10_000 });
    store.add(createSignal(), 1_200);
    const result = store.add(
      createSignal({
        id: 'signal-2',
        provider: 'NANSEN',
        confidence: 75,
        evidence: [
          {
            provider: 'NANSEN',
            providerEventId: 'nansen-1',
            receivedAt: 1_150,
          },
        ],
      }),
      1_200,
    );

    expect(result.merged).toBe(true);
    expect(result.signal.confidence).toBe(75);
    expect(result.signal.evidence).toHaveLength(2);
    expect(store.getSize(1_200)).toBe(1);
  });

  it('prunes expired signals', () => {
    const store = new ExternalSignalStore({ retentionMs: 500 });
    store.add(createSignal(), 1_200);

    expect(store.getSize(1_501)).toBe(0);
  });

  it('keeps only the newest signals when bounded by count', () => {
    const store = new ExternalSignalStore({
      maximumSignals: 2,
      retentionMs: 10_000,
    });

    store.add(createSignal(), 1_200);
    store.add(
      createSignal({
        id: 'signal-2',
        underlyingEventId: 'tx:def',
        occurredAt: 1_100,
      }),
      1_200,
    );
    store.add(
      createSignal({
        id: 'signal-3',
        underlyingEventId: 'tx:ghi',
        occurredAt: 1_200,
      }),
      1_200,
    );

    expect(store.getAll(1_200).map((signal) => signal.id)).toEqual([
      'signal-3',
      'signal-2',
    ]);
  });
});
