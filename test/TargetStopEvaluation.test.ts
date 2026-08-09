import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  TargetStopReason,
  createTargetStopPolicy,
  generateTargetStopOutcomeRecords,
  parseAlertTargetStopOutcomeRecord,
} from '../src/evaluation';
import { PATH_OUTCOME_NOW } from './helpers/pathOutcomeFixtures';
import {
  createTargetStopFixture,
  generateTargetStopFixtureRecord,
} from './helpers/targetStopFixtures';

const cell = (
  source:
    'ORDER_BOOK_MIDPOINT' | 'ORDER_BOOK_BID_ASK' | 'CONFIRMED_CANDLE_CLOSE',
  fixture = createTargetStopFixture(),
) =>
  generateTargetStopFixtureRecord(fixture).outcomes.find(
    (candidate) =>
      candidate.horizonMs === 60_000 && candidate.source === source,
  )!;

describe('target/stop policy, schema, and identity', () => {
  it.each([
    [0, 1],
    [-1, 1],
    [1, 0],
    [1, -1],
    [Number.NaN, 1],
    [1, Number.POSITIVE_INFINITY],
    [100, 1],
  ])('rejects invalid target=%s stop=%s', (targetPercent, stopPercent) => {
    expect(() =>
      createTargetStopPolicy({ targetPercent, stopPercent }),
    ).toThrow();
  });

  it('creates a deterministic fingerprint that changes with policy', () => {
    const first = createTargetStopPolicy({
      targetPercent: 1,
      stopPercent: 1,
    });
    const same = createTargetStopPolicy({
      targetPercent: 1,
      stopPercent: 1,
    });
    const changed = createTargetStopPolicy({
      targetPercent: 2,
      stopPercent: 1,
    });
    expect(same.fingerprint).toBe(first.fingerprint);
    expect(changed.fingerprint).not.toBe(first.fingerprint);
  });

  it('round-trips a complete ordered 15-cell record', () => {
    const record = generateTargetStopFixtureRecord();
    expect(parseAlertTargetStopOutcomeRecord(JSON.stringify(record))).toEqual(
      record,
    );
    expect(record.outcomes).toHaveLength(15);
  });

  it('keeps identity independent of run ID and recordedAt', () => {
    const fixture = createTargetStopFixture();
    const first = generateTargetStopFixtureRecord(fixture);
    const second = generateTargetStopFixtureRecord(fixture, first.policy, {
      targetStopRunId: 'target-stop-run:other',
      now: PATH_OUTCOME_NOW + 1,
    });
    expect(second.targetStopOutcomeId).toBe(first.targetStopOutcomeId);
    expect(second.targetStopRunId).not.toBe(first.targetStopRunId);
    expect(second.recordedAt).not.toBe(first.recordedAt);
  });

  it('changes identity when policy or immutable sources change', () => {
    const first = generateTargetStopFixtureRecord();
    const changedPolicy = generateTargetStopFixtureRecord(
      createTargetStopFixture(),
      createTargetStopPolicy({ targetPercent: 2, stopPercent: 1 }),
    );
    const changedSource = generateTargetStopFixtureRecord(
      createTargetStopFixture({ sequence: 2 }),
    );
    expect(changedPolicy.targetStopOutcomeId).not.toBe(
      first.targetStopOutcomeId,
    );
    expect(changedSource.targetStopOutcomeId).not.toBe(
      first.targetStopOutcomeId,
    );
  });
});

describe('exact midpoint first-hit ordering', () => {
  it('calculates bullish target first and exact hit metadata', () => {
    expect(cell('ORDER_BOOK_MIDPOINT').okx).toMatchObject({
      bias: 'BULLISH',
      baselinePrice: 100.5,
      targetPrice: 101.505,
      stopPrice: 99.495,
      result: 'TARGET_FIRST',
      timeToTargetMs: 30_000,
      timeToFirstHitMs: 30_000,
      firstHitPrice: 103.5,
      orderingPrecision: 'EXACT_ORDER_BOOK',
    });
  });

  it('calculates bullish stop first', () => {
    const outcome = cell(
      'ORDER_BOOK_MIDPOINT',
      createTargetStopFixture({
        bookSamples: [
          { offsetMs: 30_000, bid: 98, ask: 99 },
          { offsetMs: 45_000, bid: 103, ask: 104 },
          { offsetMs: 60_000, bid: 102, ask: 103 },
        ],
      }),
    ).okx;
    expect(outcome?.result).toBe('STOP_FIRST');
    expect(outcome?.timeToStopMs).toBe(30_000);
  });

  it('returns NEITHER with typed reasons when no boundary is reached', () => {
    const result = cell(
      'ORDER_BOOK_MIDPOINT',
      createTargetStopFixture({
        bookSamples: [{ offsetMs: 60_000, bid: 100, ask: 101 }],
      }),
    );
    expect(result.okx?.result).toBe('NEITHER');
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        TargetStopReason.TARGET_NOT_REACHED,
        TargetStopReason.STOP_NOT_REACHED,
      ]),
    );
  });

  it('accepts exact target and stop boundaries', () => {
    const target = cell(
      'ORDER_BOOK_MIDPOINT',
      createTargetStopFixture({
        bookSamples: [
          { offsetMs: 30_000, bid: 101, ask: 102.01 },
          { offsetMs: 60_000, bid: 101, ask: 102.01 },
        ],
      }),
    ).okx;
    expect(target?.firstHitPrice).toBeCloseTo(101.505, 12);
    expect(target?.result).toBe('TARGET_FIRST');

    const stop = cell(
      'ORDER_BOOK_MIDPOINT',
      createTargetStopFixture({
        bookSamples: [
          { offsetMs: 30_000, bid: 99, ask: 99.99 },
          { offsetMs: 60_000, bid: 99, ask: 99.99 },
        ],
      }),
    ).okx;
    expect(stop?.firstHitPrice).toBeCloseTo(99.495, 12);
    expect(stop?.result).toBe('STOP_FIRST');
  });

  it('keeps contradiction directions separate with opposite outcomes', () => {
    const outcome = cell(
      'ORDER_BOOK_MIDPOINT',
      createTargetStopFixture({
        okxBias: 'BULLISH',
        externalBias: 'BEARISH',
      }),
    );
    expect(outcome.okx?.result).toBe('TARGET_FIRST');
    expect(outcome.external?.result).toBe('STOP_FIRST');
    expect(outcome).not.toHaveProperty('combined');
  });

  it('omits neutral hypotheses with typed reasons', () => {
    const outcome = cell(
      'ORDER_BOOK_MIDPOINT',
      createTargetStopFixture({
        okxBias: 'NEUTRAL',
        externalBias: 'NEUTRAL',
      }),
    );
    expect(outcome.eligibility).toBe('ELIGIBLE');
    expect(outcome.okx).toBeNull();
    expect(outcome.external).toBeNull();
    expect(outcome.reasons).toEqual([
      TargetStopReason.EXTERNAL_BIAS_NEUTRAL,
      TargetStopReason.OKX_BIAS_NEUTRAL,
    ]);
  });
});

describe('executable and candle target/stop semantics', () => {
  it('uses captured ask and observed bids for bullish execution', () => {
    expect(cell('ORDER_BOOK_BID_ASK').executableOkx).toMatchObject({
      bias: 'BULLISH',
      baselinePrice: 101,
      targetPrice: 102.01,
      result: 'TARGET_FIRST',
      firstHitPrice: 103,
    });
  });

  it('uses captured bid and observed asks for bearish execution', () => {
    const result = cell(
      'ORDER_BOOK_BID_ASK',
      createTargetStopFixture({
        okxBias: 'BEARISH',
        externalBias: 'BEARISH',
      }),
    ).executableOkx;
    expect(result).toMatchObject({
      bias: 'BEARISH',
      baselinePrice: 100,
      targetPrice: 99,
      stopPrice: 101,
      result: 'STOP_FIRST',
      firstHitPrice: 101,
      timeToFirstHitMs: 0,
    });
  });

  it('uses observed bids for a bullish executable stop', () => {
    const result = cell(
      'ORDER_BOOK_BID_ASK',
      createTargetStopFixture({
        bookSamples: [
          { offsetMs: 30_000, bid: 99, ask: 100 },
          { offsetMs: 60_000, bid: 103, ask: 104 },
        ],
      }),
    ).executableOkx;
    expect(result).toMatchObject({
      bias: 'BULLISH',
      baselinePrice: 101,
      stopPrice: 99.99,
      result: 'STOP_FIRST',
      firstHitPrice: 99,
    });
  });

  it('uses observed asks for a bearish executable target', () => {
    const fixture = createTargetStopFixture({
      okxBias: 'BEARISH',
      externalBias: 'BEARISH',
      bookSamples: [
        { offsetMs: 30_000, bid: 97, ask: 98 },
        { offsetMs: 60_000, bid: 102, ask: 103 },
      ],
    });
    const result = generateTargetStopFixtureRecord(
      fixture,
      createTargetStopPolicy({ targetPercent: 1, stopPercent: 2 }),
    ).outcomes.find(
      (candidate) =>
        candidate.horizonMs === 60_000 &&
        candidate.source === 'ORDER_BOOK_BID_ASK',
    )?.executableOkx;
    expect(result).toMatchObject({
      bias: 'BEARISH',
      baselinePrice: 100,
      targetPrice: 99,
      result: 'TARGET_FIRST',
      firstHitPrice: 98,
    });
  });

  it('rejects a crossed observed path book', () => {
    const fixture = createTargetStopFixture();
    const observation =
      fixture.marketRecording.orderBookReconstruction!.observations.find(
        (sample) =>
          sample.source === 'ORDER_BOOK_BID_ASK' &&
          sample.eventTimestamp === PATH_OUTCOME_NOW - 7_200_000 + 30_000,
      )!;
    observation.bestBid = 105;
    observation.bestAsk = 104;
    const result = cell('ORDER_BOOK_BID_ASK', fixture);
    expect(result.eligibility).toBe('INELIGIBLE');
  });

  it('marks same-candle target and stop crossing ambiguous', () => {
    const result = cell('CONFIRMED_CANDLE_CLOSE');
    expect(result.eligibility).toBe('AMBIGUOUS');
    expect(result.candleOkx?.result).toBe('AMBIGUOUS');
    expect(result.candleOkx?.firstHitTimestamp).toBeNull();
    expect(result.candleOkx?.orderingPrecision).toBe('COARSE_CANDLE');
  });

  it.each([
    [102, 100, 'TARGET_FIRST'],
    [101, 99, 'STOP_FIRST'],
  ])(
    'classifies candle high=%s low=%s as %s',
    (candleHigh, candleLow, expected) => {
      const result = cell(
        'CONFIRMED_CANDLE_CLOSE',
        createTargetStopFixture({
          candleHigh,
          candleLow,
          candleClose: candleHigh === 101 ? 100 : 102,
        }),
      );
      expect(result.eligibility).toBe('ELIGIBLE');
      expect(result.candleOkx?.result).toBe(expected);
      expect(result.candleOkx?.firstHitCandleStart).toBe(
        PATH_OUTCOME_NOW - 7_200_000,
      );
    },
  );
});

describe('strict source eligibility and linkage', () => {
  it('does not trust target/stop order across a sequence gap', () => {
    const result = cell(
      'ORDER_BOOK_MIDPOINT',
      createTargetStopFixture({ includeGap: true }),
    );
    expect(result.eligibility).toBe('INELIGIBLE');
    expect(result.reasons).toContain(TargetStopReason.PATH_GAP_INTERSECTION);
  });

  it('keeps truncated paths ineligible under strict v1 policy', () => {
    const result = cell(
      'ORDER_BOOK_MIDPOINT',
      createTargetStopFixture({ clean: false }),
    );
    expect(result.eligibility).toBe('INELIGIBLE');
    expect(result.reasons).toContain(TargetStopReason.RECORDING_TRUNCATED);
  });

  it('does not turn a pre-truncation non-hit into NEITHER', () => {
    const result = cell(
      'ORDER_BOOK_MIDPOINT',
      createTargetStopFixture({
        clean: false,
        bookSamples: [{ offsetMs: 60_000, bid: 100, ask: 101 }],
      }),
    );
    expect(result.eligibility).toBe('INELIGIBLE');
    expect(result.okx).toBeNull();
    expect(result.reasons).toContain(TargetStopReason.RECORDING_TRUNCATED);
  });

  it('emits explicit source mismatch cells without omitting the matrix', () => {
    const fixture = createTargetStopFixture();
    const otherPath = createTargetStopFixture({ sequence: 2 }).pathOutcome;
    const record = generateTargetStopOutcomeRecords({
      evaluations: [fixture.evaluation],
      terminalReturns: [fixture.terminalReturn],
      pathOutcomes: [otherPath],
      marketRecording: fixture.marketRecording,
      policy: createTargetStopPolicy({ targetPercent: 1, stopPercent: 1 }),
      targetStopRunId: 'target-stop-run:mismatch',
      now: PATH_OUTCOME_NOW,
    });
    expect(record).toHaveLength(1);
    expect(record[0]?.outcomes).toHaveLength(15);
    expect(record[0]?.outcomes[0]?.reasons).toContain(
      TargetStopReason.PATH_OUTCOME_MISMATCH,
    );
  });
});

describe('offline-only compatibility boundary', () => {
  it('does not import Phase G from the live entry point or MarketEngine', () => {
    for (const file of [
      path.join(process.cwd(), 'src', 'index.ts'),
      path.join(process.cwd(), 'src', 'market', 'MarketEngine.ts'),
    ]) {
      expect(readFileSync(file, 'utf8')).not.toMatch(
        /targetStopOutcome|TargetStopOutcome/,
      );
    }
  });
});
