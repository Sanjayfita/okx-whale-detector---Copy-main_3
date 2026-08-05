import { describe, expect, it } from 'vitest';

import { measureEvidenceIndependence } from '../src/research/evidenceIndependence';

const alert = (
  alertId: string,
  instrumentId: string,
  detectedAt: number,
) => ({ alertId, instrumentId, detectedAt });

describe('measureEvidenceIndependence', () => {
  it('counts only non-overlapping maximum-horizon windows per instrument', () => {
    const result = measureEvidenceIndependence(
      [
        alert('btc-1', 'BTC-USDT', 0),
        alert('btc-2', 'BTC-USDT', 30 * 60_000),
        alert('btc-3', 'BTC-USDT', 60 * 60_000),
        alert('eth-1', 'ETH-USDT', 30 * 60_000),
      ],
      [1, 5, 15, 30, 60],
    );

    expect(result).toEqual({
      maximumOutcomeHorizonMinutes: 60,
      independentAlertCount: 3,
      dependentAlertCount: 1,
    });
  });

  it('is deterministic for unsorted alerts with equal timestamps', () => {
    const first = measureEvidenceIndependence(
      [
        alert('b', 'BTC-USDT', 1_000),
        alert('a', 'BTC-USDT', 1_000),
        alert('c', 'BTC-USDT', 61_000),
      ],
      [1],
    );
    const second = measureEvidenceIndependence(
      [
        alert('c', 'BTC-USDT', 61_000),
        alert('a', 'BTC-USDT', 1_000),
        alert('b', 'BTC-USDT', 1_000),
      ],
      [1],
    );

    expect(first).toEqual(second);
    expect(first.independentAlertCount).toBe(2);
  });

  it('rejects invalid outcome horizons', () => {
    expect(() => measureEvidenceIndependence([], [])).toThrow(
      'positive safe integers',
    );
    expect(() => measureEvidenceIndependence([], [0])).toThrow(
      'positive safe integers',
    );
  });
});
