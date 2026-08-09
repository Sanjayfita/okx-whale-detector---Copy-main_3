import { describe, expect, it } from 'vitest';

import {
  createAlertOutcomeObservation,
  parseAlertOutcomeObservation,
  type AlertOutcomeHorizonMinutes,
} from '../src/research/alertOutcomeObservation';

const input = (horizonMinutes: AlertOutcomeHorizonMinutes = 5) => ({
  evaluationId: 'evaluation-001',
  alertId: 'alert-001',
  instrumentId: 'BTC-USDT',
  detectedAt: 1_000_000,
  horizonMinutes,
  observedAt: 1_000_000 + horizonMinutes * 60_000,
  referencePrice: 100,
  observedPrice: 102,
  rawReturnPercent: 2,
  directionAdjustedReturnPercent: 2,
  maximumFavorableExcursionPercent: 3,
  maximumAdverseExcursionPercent: 1,
});

describe('createAlertOutcomeObservation', () => {
  it.each([1, 5, 15, 30, 60] as const)(
    'creates a complete observation for the %s-minute horizon',
    (horizonMinutes) => {
      const observation = createAlertOutcomeObservation(input(horizonMinutes));

      expect(observation.horizonMinutes).toBe(horizonMinutes);
      expect(observation.complete).toBe(true);
      expect(observation.liveOrderExecutionAllowed).toBe(false);
      expect(Object.isFrozen(observation)).toBe(true);
    },
  );

  it('rejects observations recorded before their requested horizon', () => {
    expect(() =>
      createAlertOutcomeObservation({
        ...input(5),
        observedAt: 1_000_000 + 4 * 60_000,
      }),
    ).toThrow('observedAt cannot be earlier than the requested horizon');
  });

  it('rejects invalid prices and excursion percentages', () => {
    expect(() =>
      createAlertOutcomeObservation({ ...input(), observedPrice: 0 }),
    ).toThrow('observedPrice must be a positive finite number');

    expect(() =>
      createAlertOutcomeObservation({
        ...input(),
        maximumAdverseExcursionPercent: -1,
      }),
    ).toThrow(
      'maximumAdverseExcursionPercent must be a non-negative finite number',
    );
  });

  it('rejects empty evidence identifiers', () => {
    expect(() =>
      createAlertOutcomeObservation({ ...input(), alertId: ' ' }),
    ).toThrow('alertId must not be empty');
  });

  it('distinguishes unavailable path excursions from observed zeroes', () => {
    const unavailable = createAlertOutcomeObservation({
      ...input(),
      maximumFavorableExcursionPercent: 0,
      maximumAdverseExcursionPercent: 0,
      excursionMeasurement: 'UNAVAILABLE',
    });
    const legacy = parseAlertOutcomeObservation({
      ...unavailable,
      excursionMeasurement: undefined,
    });

    expect(unavailable.excursionMeasurement).toBe('UNAVAILABLE');
    expect(legacy?.excursionMeasurement).toBe('LEGACY_UNSPECIFIED');
    expect(() =>
      createAlertOutcomeObservation({
        ...input(),
        excursionMeasurement: 'UNAVAILABLE',
      }),
    ).toThrow('zero placeholders');
  });

  it('rejects non-finite or price-inconsistent returns', () => {
    expect(() =>
      createAlertOutcomeObservation({
        ...input(),
        rawReturnPercent: Number.NaN,
      }),
    ).toThrow('rawReturnPercent must be a finite number');

    expect(() =>
      createAlertOutcomeObservation({
        ...input(),
        rawReturnPercent: 999,
      }),
    ).toThrow('rawReturnPercent does not match the recorded prices');

    expect(() =>
      createAlertOutcomeObservation({
        ...input(),
        directionAdjustedReturnPercent: Number.POSITIVE_INFINITY,
      }),
    ).toThrow('directionAdjustedReturnPercent must be a finite number');
  });
});
