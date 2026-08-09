import { describe, expect, it } from 'vitest';

import {
  MARKET_RECORDING_CLOCK_BASIS,
  MARKET_RECORDING_SCHEMA_VERSION,
  type MarketRecordingHeaderRecord,
} from '../src/recording/marketRecordingFormat';
import {
  LEGACY_ALIGNMENT_MANIFEST_SCHEMA_VERSION,
  validateLegacyLinkage,
  type LegacyAlignmentManifest,
} from '../src/evaluation/legacyAlignmentManifest';
import { AlignmentReason } from '../src/evaluation/alignmentTypes';
import {
  createInstrumentKey,
  validateSessionLinkage,
} from '../src/evaluation/alignmentValidation';

const NOW = Date.UTC(2026, 6, 29, 12);
const SPOT = createInstrumentKey('BTC-USDT', 'SPOT');
const SWAP = createInstrumentKey('BTC-USDT-SWAP', 'SWAP');

const header = (
  overrides: Partial<MarketRecordingHeaderRecord> = {},
): MarketRecordingHeaderRecord => ({
  recordType: 'header',
  schemaVersion: MARKET_RECORDING_SCHEMA_VERSION,
  recordedAt: NOW,
  sourceSessionId: 'session-one',
  recordingId: 'recording-one',
  startedAt: NOW,
  producer: { name: 'test', version: '1.0.0' },
  clockBasis: MARKET_RECORDING_CLOCK_BASIS,
  instruments: [
    {
      instId: SPOT.instId,
      instType: SPOT.instType,
      quoteCurrency: 'USDT',
      baseUnitsPerSize: 1,
    },
  ],
  subscriptions: {
    orderBookChannel: 'books',
    orderBookDepth: 400,
    candleIntervals: ['1m'],
  },
  ...overrides,
});

describe('versioned market-session linkage', () => {
  it('links only through a matching recording header and instrument key', () => {
    expect(
      validateSessionLinkage({
        alertSourceSessionId: 'session-one',
        expectedRecordingId: 'recording-one',
        instrument: SPOT,
        candidateHeaders: [header()],
      }),
    ).toMatchObject({
      valid: true,
      value: {
        header: {
          sourceSessionId: 'session-one',
          recordingId: 'recording-one',
        },
        instrument: {
          instId: 'BTC-USDT',
          instType: 'SPOT',
        },
      },
    });
  });

  it('rejects missing and mismatched session linkage', () => {
    expect(
      validateSessionLinkage({
        instrument: SPOT,
        candidateHeaders: [header()],
      }),
    ).toMatchObject({
      valid: false,
      primaryReason: AlignmentReason.NO_MATCHING_MARKET_SESSION,
    });
    expect(
      validateSessionLinkage({
        alertSourceSessionId: 'session-two',
        instrument: SPOT,
        candidateHeaders: [header()],
      }),
    ).toMatchObject({
      valid: false,
      primaryReason: AlignmentReason.NO_MATCHING_MARKET_SESSION,
    });
  });

  it('requires a durable recording identity', () => {
    expect(
      validateSessionLinkage({
        alertSourceSessionId: 'session-one',
        instrument: SPOT,
        candidateHeaders: [
          header({
            recordingId: '' as MarketRecordingHeaderRecord['recordingId'],
          }),
        ],
      }),
    ).toMatchObject({
      valid: false,
      primaryReason: AlignmentReason.RECORDING_ID_MISSING,
    });
  });

  it('rejects ambiguous matching headers unless recording ID disambiguates them', () => {
    const headers = [
      header({ recordingId: 'recording-one' }),
      header({ recordingId: 'recording-two' }),
    ];

    expect(
      validateSessionLinkage({
        alertSourceSessionId: 'session-one',
        instrument: SPOT,
        candidateHeaders: headers,
      }),
    ).toMatchObject({
      valid: false,
      completeness: 'AMBIGUOUS',
      primaryReason: AlignmentReason.MARKET_SESSION_AMBIGUOUS,
    });
    expect(
      validateSessionLinkage({
        alertSourceSessionId: 'session-one',
        expectedRecordingId: 'recording-two',
        instrument: SPOT,
        candidateHeaders: headers,
      }).valid,
    ).toBe(true);
  });

  it('distinguishes missing, mismatched, and conflicting instrument metadata', () => {
    expect(
      validateSessionLinkage({
        alertSourceSessionId: 'session-one',
        instrument: SPOT,
        candidateHeaders: [header({ instruments: [] })],
      }),
    ).toMatchObject({
      valid: false,
      primaryReason: AlignmentReason.INSTRUMENT_METADATA_MISSING,
    });
    expect(
      validateSessionLinkage({
        alertSourceSessionId: 'session-one',
        instrument: SPOT,
        candidateHeaders: [
          header({
            instruments: [
              {
                instId: 'ETH-USDT',
                instType: 'SPOT',
                quoteCurrency: 'USDT',
                baseUnitsPerSize: 1,
              },
            ],
          }),
        ],
      }),
    ).toMatchObject({
      valid: false,
      primaryReason: AlignmentReason.INSTRUMENT_MISMATCH,
    });
    expect(
      validateSessionLinkage({
        alertSourceSessionId: 'session-one',
        instrument: createInstrumentKey('BTC-USDT', 'SWAP'),
        candidateHeaders: [header()],
      }),
    ).toMatchObject({
      valid: false,
      primaryReason: AlignmentReason.INSTRUMENT_METADATA_CONFLICT,
    });
  });
});

const ALERT_DIGEST = 'a'.repeat(64);
const MARKET_DIGEST = 'b'.repeat(64);

const manifest = (
  overrides: Partial<LegacyAlignmentManifest> = {},
): LegacyAlignmentManifest => ({
  schemaVersion: LEGACY_ALIGNMENT_MANIFEST_SCHEMA_VERSION,
  manifestId: 'legacy-manifest-one',
  alertFileDigest: ALERT_DIGEST,
  marketFileDigest: MARKET_DIGEST,
  instrumentMappings: [
    {
      alertSymbol: 'BTC-USDT',
      marketInstrument: SPOT,
    },
  ],
  candleIntervals: [{ instrument: SPOT, interval: '1m' }],
  provenance: 'EXPLICIT_EXTERNAL_MANIFEST',
  ...overrides,
});

const legacyRequest = (
  overrides: Partial<Parameters<typeof validateLegacyLinkage>[0]> = {},
) => ({
  manifest: manifest(),
  alertFileDigest: ALERT_DIGEST,
  marketFileDigest: MARKET_DIGEST,
  alertSymbol: 'BTC-USDT',
  expectedInstrument: SPOT,
  ...overrides,
});

describe('explicit legacy recording linkage', () => {
  it('accepts an explicit manifest with matching digests and instrument mapping', () => {
    expect(validateLegacyLinkage(legacyRequest()).valid).toBe(true);
  });

  it('does not infer linkage when the manifest is absent', () => {
    expect(
      validateLegacyLinkage(legacyRequest({ manifest: undefined })),
    ).toMatchObject({
      valid: false,
      primaryReason: AlignmentReason.LEGACY_LINKAGE_UNVERIFIED,
    });
  });

  it('rejects digest mismatches and ambiguous mappings', () => {
    expect(
      validateLegacyLinkage(legacyRequest({ alertFileDigest: 'c'.repeat(64) })),
    ).toMatchObject({
      valid: false,
      primaryReason: AlignmentReason.LEGACY_LINKAGE_UNVERIFIED,
    });
    expect(
      validateLegacyLinkage(
        legacyRequest({
          manifest: manifest({
            instrumentMappings: [
              { alertSymbol: 'BTC-USDT', marketInstrument: SPOT },
              { alertSymbol: 'BTC-USDT', marketInstrument: SWAP },
            ],
          }),
        }),
      ),
    ).toMatchObject({
      valid: false,
      completeness: 'AMBIGUOUS',
      primaryReason: AlignmentReason.INSTRUMENT_METADATA_CONFLICT,
    });
  });

  it('rejects inferred instrument metadata and invalid candle declarations', () => {
    expect(
      validateLegacyLinkage(
        legacyRequest({
          manifest: manifest({
            instrumentMappings: [
              { alertSymbol: 'BTC-USDT', marketInstrument: SWAP },
            ],
          }),
        }),
      ),
    ).toMatchObject({
      valid: false,
      primaryReason: AlignmentReason.INSTRUMENT_MISMATCH,
    });
    expect(
      validateLegacyLinkage(
        legacyRequest({
          manifest: manifest({
            candleIntervals: [{ instrument: SPOT, interval: '' }],
          }),
        }),
      ),
    ).toMatchObject({
      valid: false,
      primaryReason: AlignmentReason.CANDLE_INTERVAL_UNKNOWN,
    });
  });
});
