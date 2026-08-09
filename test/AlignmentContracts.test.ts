import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ALIGNMENT_CONFIGURATION,
  createAlignmentConfiguration,
  createAlignmentConfigurationFingerprint,
  getAlignmentEvaluationConfigVersion,
  serializeAlignmentConfiguration,
} from '../src/evaluation/alignmentConfiguration';
import {
  AlignmentReason,
  alignmentFailure,
} from '../src/evaluation/alignmentTypes';
import {
  createInstrumentKey,
  instrumentKeysEqual,
  serializeInstrumentKey,
  validateInstrumentKey,
} from '../src/evaluation/alignmentValidation';

describe('alignment contracts and configuration', () => {
  it('constructs, serializes, and compares authoritative SPOT keys', () => {
    const first = createInstrumentKey('BTC-USDT', 'SPOT');
    const second = createInstrumentKey('BTC-USDT', 'SPOT');

    expect(instrumentKeysEqual(first, second)).toBe(true);
    expect(serializeInstrumentKey(first)).toBe('["BTC-USDT","SPOT"]');
  });

  it('constructs and compares authoritative SWAP keys', () => {
    expect(
      instrumentKeysEqual(
        createInstrumentKey('BTC-USDT-SWAP', 'SWAP'),
        createInstrumentKey('BTC-USDT-SWAP', 'SWAP'),
      ),
    ).toBe(true);
  });

  it('keeps the same instId separate across instrument types', () => {
    expect(
      instrumentKeysEqual(
        createInstrumentKey('BTC-USDT-SWAP', 'SPOT'),
        createInstrumentKey('BTC-USDT-SWAP', 'SWAP'),
      ),
    ).toBe(false);
  });

  it('does not infer instrument type from a symbol suffix', () => {
    expect(createInstrumentKey('BTC-USDT-SWAP', 'SPOT')).toEqual({
      instId: 'BTC-USDT-SWAP',
      instType: 'SPOT',
    });
  });

  it.each([
    [{ instId: '', instType: 'SPOT' }],
    [{ instId: 'btc-usdt', instType: 'SPOT' }],
    [{ instId: 'BTC-USDT', instType: 'FUTURE' }],
    [{ instId: 'BTC-USDT' }],
  ])('rejects invalid instrument keys', (value) => {
    expect(validateInstrumentKey(value).valid).toBe(false);
  });

  it('uses the documented default horizons and no fallback', () => {
    expect(DEFAULT_ALIGNMENT_CONFIGURATION).toMatchObject({
      version: 'alignment-v1',
      horizonsMs: [60_000, 300_000, 900_000, 1_800_000, 3_600_000],
      sourceFallback: 'NONE',
      orderBookMaximumEventLatenessMs: 5_000,
      candleMaximumEventLatenessMs: 60_000,
      localArrivalAllowanceMs: 5_000,
      allowedClockSkewMs: 5_000,
      legacyReferenceMaximumAgeMs: 5_000,
      minimumValidTimestampMs: Date.UTC(2000, 0, 1),
      maximumValidTimestampMs: Date.UTC(2100, 0, 1),
      maximumFutureOffsetMs: 86_400_000,
    });
  });

  it.each([
    [[60_000, 60_000], 'unique'],
    [[0], 'positive'],
    [[-1], 'positive'],
    [[300_000, 60_000], 'increasing'],
  ])('rejects invalid horizon configuration %j', (horizonsMs, message) => {
    expect(() => createAlignmentConfiguration({ horizonsMs })).toThrow(message);
  });

  it('rejects invalid lateness', () => {
    expect(() =>
      createAlignmentConfiguration({
        orderBookMaximumEventLatenessMs: -1,
      }),
    ).toThrow('orderBookMaximumEventLatenessMs');
  });

  it('rejects an invalid fallback mode', () => {
    expect(() =>
      createAlignmentConfiguration({
        sourceFallback: 'SILENT_FALLBACK' as 'NONE',
      }),
    ).toThrow('fallback');
  });

  it('serializes and fingerprints configuration deterministically', () => {
    const first = createAlignmentConfiguration();
    const second = createAlignmentConfiguration({
      horizonsMs: [60_000, 300_000, 900_000, 1_800_000, 3_600_000],
    });

    expect(serializeAlignmentConfiguration(second)).toBe(
      serializeAlignmentConfiguration(first),
    );
    expect(createAlignmentConfigurationFingerprint(second)).toBe(
      createAlignmentConfigurationFingerprint(first),
    );
    expect(createAlignmentConfigurationFingerprint(first)).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(getAlignmentEvaluationConfigVersion(first)).toMatch(
      /^alignment-v1:[a-f0-9]{64}$/,
    );
  });

  it('keeps primary reason first and de-duplicates ordered reasons', () => {
    expect(
      alignmentFailure(AlignmentReason.SEQUENCE_GAP, 'MISSING', [
        AlignmentReason.BOOK_INVALID,
        AlignmentReason.SEQUENCE_GAP,
      ]),
    ).toEqual({
      valid: false,
      completeness: 'MISSING',
      primaryReason: AlignmentReason.SEQUENCE_GAP,
      reasons: [AlignmentReason.SEQUENCE_GAP, AlignmentReason.BOOK_INVALID],
    });
  });
});
