import { describe, expect, it } from 'vitest';

import {
  AlignmentReason,
  PathOutcomeReason,
  createPathOutcomePolicy,
  generatePathOutcomeRecords,
  parseAlertPathOutcomeRecord,
} from '../src/evaluation';
import {
  PATH_OUTCOME_NOW,
  createPathFixture,
  generatePathFixtureRecord,
} from './helpers/pathOutcomeFixtures';

const firstCell = (
  source:
    'ORDER_BOOK_MIDPOINT' | 'ORDER_BOOK_BID_ASK' | 'CONFIRMED_CANDLE_CLOSE',
  fixture = createPathFixture(),
) =>
  generatePathFixtureRecord(fixture).paths.find(
    (cell) => cell.horizonMs === 60_000 && cell.source === source,
  )!;

describe('path-outcome schema, policy, and identity', () => {
  it('creates a valid versioned record with the complete Phase D matrix', () => {
    const fixture = createPathFixture();
    const record = generatePathFixtureRecord(fixture);

    expect(parseAlertPathOutcomeRecord(JSON.stringify(record))).toEqual(record);
    expect(record.paths).toHaveLength(15);
    expect(record.paths.map((cell) => [cell.horizonMs, cell.source])).toEqual(
      fixture.evaluation.alignments.map((cell) => [
        cell.horizonMs,
        cell.source,
      ]),
    );
    expect(record.sourceTerminalReturnId).toBe(
      fixture.terminalReturn.outcomeId,
    );
  });

  it('uses a stable canonical policy fingerprint', () => {
    expect(createPathOutcomePolicy().fingerprint).toBe(
      createPathOutcomePolicy({
        floatingPointPolicy: {
          relativeTolerance: 1e-12,
          absoluteTolerance: 1e-12,
        },
      }).fingerprint,
    );
  });

  it('keeps identity independent of run ID and recordedAt', () => {
    const fixture = createPathFixture();
    const first = generatePathFixtureRecord(fixture);
    const second = generatePathFixtureRecord(fixture, {
      pathOutcomeRunId: 'path-outcome-run:other',
      now: PATH_OUTCOME_NOW + 1,
    });
    expect(second.pathOutcomeId).toBe(first.pathOutcomeId);
    expect(second.pathOutcomeRunId).not.toBe(first.pathOutcomeRunId);
    expect(second.recordedAt).not.toBe(first.recordedAt);
  });

  it('changes identity for policy and source changes', () => {
    const first = generatePathFixtureRecord(createPathFixture({ sequence: 1 }));
    const changedSource = generatePathFixtureRecord(
      createPathFixture({ sequence: 2 }),
    );
    const changedPolicy = generatePathFixtureRecord(createPathFixture(), {
      policy: createPathOutcomePolicy({
        floatingPointPolicy: { absoluteTolerance: 2e-12 },
      }),
    });
    expect(changedSource.pathOutcomeId).not.toBe(first.pathOutcomeId);
    expect(changedPolicy.pathOutcomeId).not.toBe(first.pathOutcomeId);
  });

  it.each([
    ['schemaVersion', 2, 'Unsupported path-outcome schema version'],
    ['pathOutcomeId', 'bad id', 'Invalid pathOutcomeId'],
    ['sourceTerminalReturnId', 'bad', 'Invalid sourceTerminalReturnId'],
  ])('rejects malformed %s', (property, value, message) => {
    const record = structuredClone(generatePathFixtureRecord());
    Object.assign(record, { [property]: value });
    expect(() => parseAlertPathOutcomeRecord(JSON.stringify(record))).toThrow(
      message,
    );
  });

  it('rejects a changed policy fingerprint and incomplete matrix', () => {
    const fingerprint = structuredClone(generatePathFixtureRecord());
    fingerprint.policy.fingerprint = '0'.repeat(64);
    expect(() =>
      parseAlertPathOutcomeRecord(JSON.stringify(fingerprint)),
    ).toThrow('Invalid path-outcome policy fingerprint');

    const matrix = structuredClone(generatePathFixtureRecord());
    matrix.paths.pop();
    expect(() => parseAlertPathOutcomeRecord(JSON.stringify(matrix))).toThrow(
      'Path matrix must be complete',
    );
  });
});

describe('path windows and midpoint extrema', () => {
  it('includes exact start and horizon boundaries without interpolation', () => {
    const cell = firstCell('ORDER_BOOK_MIDPOINT');
    expect(cell.firstSampleTimestamp).toBe(PATH_OUTCOME_NOW - 7_200_000);
    expect(cell.lastSampleTimestamp).toBe(
      PATH_OUTCOME_NOW - 7_200_000 + 60_000,
    );
    expect(cell.sampleCount).toBe(4);
  });

  it('calculates raw upward MFE and downward MAE from captured midpoint', () => {
    const cell = firstCell('ORDER_BOOK_MIDPOINT');
    expect(cell.raw).toMatchObject({
      favorableExcursion: 3,
      favorableExcursionPercent: (3 / 100.5) * 100,
      adverseExcursion: 2,
      adverseExcursionPercent: (2 / 100.5) * 100,
      timeToFavorableMs: 30_000,
      timeToAdverseMs: 45_000,
      favorablePrice: 103.5,
      adversePrice: 98.5,
    });
  });

  it('calculates bullish and bearish paths independently for contradiction', () => {
    const cell = firstCell(
      'ORDER_BOOK_MIDPOINT',
      createPathFixture({
        okxBias: 'BULLISH',
        externalBias: 'BEARISH',
      }),
    );
    expect(cell.okxDirectional).toMatchObject({
      bias: 'BULLISH',
      favorableExcursion: 3,
      adverseExcursion: 2,
      timeToFavorableMs: 30_000,
      timeToAdverseMs: 45_000,
    });
    expect(cell.externalDirectional).toMatchObject({
      bias: 'BEARISH',
      favorableExcursion: 2,
      adverseExcursion: 3,
      timeToFavorableMs: 45_000,
      timeToAdverseMs: 30_000,
    });
    expect(cell).not.toHaveProperty('combinedDirectional');
  });

  it('uses the earliest event, availability, and ordinal for equal extrema', () => {
    const fixture = createPathFixture({
      bookSamples: [
        { offsetMs: 10_000, bid: 102, ask: 103 },
        { offsetMs: 20_000, bid: 100, ask: 101 },
        { offsetMs: 30_000, bid: 102, ask: 103 },
        { offsetMs: 60_000, bid: 100, ask: 101 },
      ],
    });
    const cell = firstCell('ORDER_BOOK_MIDPOINT', fixture);
    expect(cell.raw?.favorableExcursion).toBe(2);
    expect(cell.raw?.timeToFavorableMs).toBe(10_000);
    expect(cell.raw?.adverseExcursion).toBe(0);
    expect(cell.raw?.timeToAdverseMs).toBe(0);
  });

  it('allows zero movement with zero time at the captured baseline', () => {
    const cell = firstCell(
      'ORDER_BOOK_MIDPOINT',
      createPathFixture({
        bookSamples: [{ offsetMs: 60_000, bid: 100, ask: 101 }],
      }),
    );
    expect(cell.raw).toMatchObject({
      favorableExcursion: 0,
      adverseExcursion: 0,
      timeToFavorableMs: 0,
      timeToAdverseMs: 0,
    });
  });

  it('omits neutral directional results with typed reasons', () => {
    const cell = firstCell(
      'ORDER_BOOK_MIDPOINT',
      createPathFixture({ okxBias: 'NEUTRAL', externalBias: 'NEUTRAL' }),
    );
    expect(cell.eligibility).toBe('ELIGIBLE');
    expect(cell.raw).not.toBeNull();
    expect(cell.okxDirectional).toBeNull();
    expect(cell.externalDirectional).toBeNull();
    expect(cell.reasons).toEqual([
      PathOutcomeReason.EXTERNAL_BIAS_NEUTRAL,
      PathOutcomeReason.OKX_BIAS_NEUTRAL,
    ]);
  });

  it('rejects a sample that arrived after its path horizon', () => {
    const fixture = createPathFixture();
    const observation =
      fixture.marketRecording.orderBookReconstruction!.observations.find(
        (sample) =>
          sample.source === 'ORDER_BOOK_MIDPOINT' &&
          sample.eventTimestamp === PATH_OUTCOME_NOW - 7_200_000 + 30_000,
      )!;
    observation.availabilityTimestamp = PATH_OUTCOME_NOW - 7_200_000 + 60_001;
    const cell = firstCell('ORDER_BOOK_MIDPOINT', fixture);
    expect(cell.eligibility).toBe('INELIGIBLE');
    expect(cell.reasons).toContain(PathOutcomeReason.PATH_SAMPLE_UNAVAILABLE);
    expect(cell.raw).toBeNull();
  });
});

describe('executable bid/ask path semantics', () => {
  it('uses captured ask to observed bids for a bullish hypothesis', () => {
    const cell = firstCell('ORDER_BOOK_BID_ASK');
    expect(cell.executableOkx).toMatchObject({
      bias: 'BULLISH',
      entryPrice: 101,
      favorableExcursion: 2,
      adverseExcursion: 3,
      timeToFavorableMs: 30_000,
      timeToAdverseMs: 45_000,
      pricePolicy: 'REFERENCE_ASK_TO_OBSERVED_BID',
    });
  });

  it('uses captured bid to observed asks for a bearish hypothesis', () => {
    const cell = firstCell(
      'ORDER_BOOK_BID_ASK',
      createPathFixture({ okxBias: 'BEARISH', externalBias: 'BEARISH' }),
    );
    expect(cell.executableOkx).toMatchObject({
      bias: 'BEARISH',
      entryPrice: 100,
      favorableExcursion: 1,
      adverseExcursion: 4,
      timeToFavorableMs: 45_000,
      timeToAdverseMs: 30_000,
      pricePolicy: 'REFERENCE_BID_TO_OBSERVED_ASK',
    });
  });

  it('keeps OKX and external executable hypotheses separate', () => {
    const cell = firstCell(
      'ORDER_BOOK_BID_ASK',
      createPathFixture({
        okxBias: 'BULLISH',
        externalBias: 'BEARISH',
      }),
    );
    expect(cell.executableOkx?.bias).toBe('BULLISH');
    expect(cell.executableExternal?.bias).toBe('BEARISH');
    expect(cell).not.toHaveProperty('executedTrade');
    expect(cell).not.toHaveProperty('fees');
    expect(cell).not.toHaveProperty('slippage');
  });

  it.each([
    ['crossed', 105, 104],
    ['missing bid', undefined, 104],
  ])('rejects a %s observed path book', (_label, bestBid, bestAsk) => {
    const fixture = createPathFixture();
    const observation =
      fixture.marketRecording.orderBookReconstruction!.observations.find(
        (sample) =>
          sample.source === 'ORDER_BOOK_BID_ASK' &&
          sample.eventTimestamp === PATH_OUTCOME_NOW - 7_200_000 + 30_000,
      )!;
    observation.bestBid = bestBid;
    observation.bestAsk = bestAsk;
    const cell = firstCell('ORDER_BOOK_BID_ASK', fixture);
    expect(cell.eligibility).toBe('INELIGIBLE');
    expect(cell.reasons).toContain(PathOutcomeReason.PATH_SAMPLE_INVALID);
  });
});

describe('confirmed-candle bounds and strict eligibility', () => {
  it('uses fully post-alert confirmed high/low bounds with unknown ordering', () => {
    const cell = firstCell('CONFIRMED_CANDLE_CLOSE');
    expect(cell.eligibility).toBe('ELIGIBLE');
    expect(cell.sampleCount).toBe(1);
    expect(cell.raw).toBeNull();
    expect(cell.candleBounds?.okx).toEqual({
      bias: 'BULLISH',
      favorableBound: 3.5,
      adverseBound: 2.5,
      favorableBoundPercent: (3.5 / 100.5) * 100,
      adverseBoundPercent: (2.5 / 100.5) * 100,
      favorablePrice: 104,
      adversePrice: 98,
      favorableCandleStart: PATH_OUTCOME_NOW - 7_200_000,
      adverseCandleStart: PATH_OUTCOME_NOW - 7_200_000,
      orderingKnown: false,
    });
  });

  it('marks a conflicting candle duplicate ambiguous', () => {
    const cell = generatePathFixtureRecord(
      createPathFixture({ conflictingCandle: true }),
    ).paths.find(
      (candidate) =>
        candidate.source === 'CONFIRMED_CANDLE_CLOSE' &&
        candidate.horizonMs === 300_000,
    )!;
    expect(cell.eligibility).toBe('AMBIGUOUS');
    expect(cell.reasons).toContain(
      PathOutcomeReason.CANDLE_CONFLICTING_DUPLICATE,
    );
  });

  it('marks a missing confirmed interval ineligible', () => {
    const cell = firstCell(
      'CONFIRMED_CANDLE_CLOSE',
      createPathFixture({
        omitCandleStart: PATH_OUTCOME_NOW - 7_200_000,
      }),
    );
    expect(cell.eligibility).toBe('INELIGIBLE');
    expect(cell.reasons).toContain(PathOutcomeReason.CANDLE_INTERVAL_MISSING);
    expect(cell.reasons).toContain(PathOutcomeReason.NO_PATH_SAMPLES);
  });

  it('excludes the alert-containing candle without inferring intrabar order', () => {
    const referenceTimestamp = PATH_OUTCOME_NOW - 7_200_000 + 30_000;
    const cell = generatePathFixtureRecord(
      createPathFixture({ referenceTimestamp }),
    ).paths.find(
      (candidate) =>
        candidate.source === 'CONFIRMED_CANDLE_CLOSE' &&
        candidate.horizonMs === 300_000,
    )!;
    expect(cell.eligibility).toBe('ELIGIBLE');
    expect(cell.reasons).toContain(
      PathOutcomeReason.CANDLE_PARTIAL_ALERT_INTERVAL,
    );
    expect(cell.firstSampleTimestamp).toBe(
      PATH_OUTCOME_NOW - 7_200_000 + 120_000,
    );
    expect(cell.candleBounds?.okx?.orderingKnown).toBe(false);
  });

  it('disqualifies any intersecting order-book validity gap', () => {
    const cell = firstCell(
      'ORDER_BOOK_MIDPOINT',
      createPathFixture({ includeGap: true }),
    );
    expect(cell.eligibility).toBe('INELIGIBLE');
    expect(cell.reasons).toContain(PathOutcomeReason.PATH_GAP_INTERSECTION);
    expect(cell.validityGaps.length).toBeGreaterThan(0);
  });

  it.each([
    AlignmentReason.SEQUENCE_GAP,
    AlignmentReason.BOOK_INVALID,
    AlignmentReason.EVENT_TIME_OUT_OF_ORDER,
    AlignmentReason.RECORDING_TRUNCATED,
  ])('disqualifies an intersecting %s interval', (reason) => {
    const fixture = createPathFixture();
    const reconstruction = fixture.marketRecording.orderBookReconstruction!;
    (
      reconstruction as {
        validityGaps: readonly {
          instrument: { instId: string; instType: 'SPOT' };
          startTimestamp: number;
          endTimestamp?: number;
          reason: typeof reason;
        }[];
      }
    ).validityGaps = [
      {
        instrument: { instId: 'BTC-USDT', instType: 'SPOT' },
        startTimestamp: PATH_OUTCOME_NOW - 7_200_000 + 20_000,
        ...(reason === AlignmentReason.RECORDING_TRUNCATED
          ? {}
          : {
              endTimestamp: PATH_OUTCOME_NOW - 7_200_000 + 25_000,
            }),
        reason,
      },
    ];
    const cell = firstCell('ORDER_BOOK_MIDPOINT', fixture);
    expect(cell.eligibility).toBe('INELIGIBLE');
    expect(cell.reasons).toContain(PathOutcomeReason.PATH_GAP_INTERSECTION);
  });

  it('keeps every incomplete Phase D cell explicit and untrusted', () => {
    const fixture = createPathFixture();
    const alignment = fixture.evaluation.alignments[0]!;
    alignment.completeness = 'PARTIAL';
    alignment.primaryReason = AlignmentReason.RECORDING_TRUNCATED;
    alignment.reasons = [AlignmentReason.RECORDING_TRUNCATED];
    const record = generatePathFixtureRecord(fixture);
    expect(record.paths[0]).toMatchObject({
      eligibility: 'INELIGIBLE',
      reasons: expect.arrayContaining([
        PathOutcomeReason.ALIGNMENT_PARTIAL,
        PathOutcomeReason.POLICY_INELIGIBLE,
      ]),
      raw: null,
    });
  });

  it('reports clean end-before-horizon and truncated unfinished paths', () => {
    const clean = createPathFixture();
    clean.marketRecording.candleRecording!.footer!.endedAt =
      PATH_OUTCOME_NOW - 7_200_000 + 30_000;
    expect(firstCell('ORDER_BOOK_MIDPOINT', clean).reasons).toContain(
      PathOutcomeReason.RECORDING_ENDED_BEFORE_HORIZON,
    );

    const truncated = createPathFixture({
      clean: false,
      bookSamples: [{ offsetMs: 30_000, bid: 102, ask: 103 }],
    });
    expect(firstCell('ORDER_BOOK_MIDPOINT', truncated).reasons).toContain(
      PathOutcomeReason.RECORDING_TRUNCATED,
    );
  });

  it('emits explicit invalid cells for terminal and recording mismatches', () => {
    const fixture = createPathFixture();
    const missingReturn = generatePathOutcomeRecords({
      evaluations: [fixture.evaluation],
      terminalReturns: [],
      marketRecording: fixture.marketRecording,
      pathOutcomeRunId: 'path-outcome-run:mismatch',
      now: PATH_OUTCOME_NOW,
    })[0]!;
    expect(
      missingReturn.paths.every((cell) => cell.eligibility !== 'ELIGIBLE'),
    ).toBe(true);
    expect(missingReturn.paths[0]?.reasons).toContain(
      PathOutcomeReason.SOURCE_RETURN_MISMATCH,
    );

    fixture.marketRecording.header!.recordingId = 'market-recording:other';
    const marketMismatch = generatePathOutcomeRecords({
      evaluations: [fixture.evaluation],
      terminalReturns: [fixture.terminalReturn],
      marketRecording: fixture.marketRecording,
      pathOutcomeRunId: 'path-outcome-run:mismatch',
      now: PATH_OUTCOME_NOW,
    })[0]!;
    expect(marketMismatch.paths[0]?.reasons).toContain(
      PathOutcomeReason.MARKET_RECORDING_MISMATCH,
    );
  });
});
