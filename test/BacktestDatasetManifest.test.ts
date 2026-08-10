import { describe, expect, it } from 'vitest';
import { createBacktestDatasetManifest } from '../src/backtest/BacktestDatasetManifest';

const hash = 'a'.repeat(64);

describe('backtest dataset manifest', () => {
  it('reports complete deterministic coverage', () => {
    const manifest = createBacktestDatasetManifest({
      datasetId: 'btc-1m-v1',
      instrumentId: 'BTC-USDT-SWAP',
      sourceSha256: hash,
      createdAt: 10_000,
      expectedCandleIntervalMs: 60_000,
      candles: [0, 60_000, 120_000].map((timestamp) => ({
        timestamp,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        confirm: true,
      })),
      fundingEvents: [],
    });

    expect(manifest).toMatchObject({
      qualityStatus: 'VERIFIED',
      researchEligible: true,
      confirmedCandleCount: 3,
      gapCount: 0,
      estimatedMissingCandleCount: 0,
    });
  });

  it('fails coverage when expected candle intervals are missing', () => {
    const manifest = createBacktestDatasetManifest({
      datasetId: 'btc-1m-gap-v1',
      instrumentId: 'BTC-USDT-SWAP',
      sourceSha256: hash,
      createdAt: 10_000,
      expectedCandleIntervalMs: 60_000,
      candles: [0, 180_000].map((timestamp) => ({
        timestamp,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        confirm: true,
      })),
      fundingEvents: [],
    });

    expect(manifest).toMatchObject({
      qualityStatus: 'FAILED',
      researchEligible: false,
      gapCount: 1,
      estimatedMissingCandleCount: 2,
    });
  });

  it('does not certify a legacy dataset without an expected interval', () => {
    const manifest = createBacktestDatasetManifest({
      datasetId: 'legacy-unversioned',
      instrumentId: 'BTC-USDT-SWAP',
      sourceSha256: hash,
      createdAt: 10_000,
      expectedCandleIntervalMs: null,
      candles: [],
      fundingEvents: [],
    });
    expect(manifest.qualityStatus).toBe('UNVERIFIED_INTERVAL');
    expect(manifest.researchEligible).toBe(false);
  });
});
