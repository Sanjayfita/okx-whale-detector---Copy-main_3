import { describe, expect, it } from 'vitest';

import {
  TerminalReturnReason,
  createTerminalReturnPolicy,
  generateTerminalReturnRecords,
} from '../src/evaluation';
import {
  TERMINAL_RETURN_NOW,
  createReturnEvaluation,
  createTerminalReturnRecord,
  setAlignmentCompleteness,
} from './helpers/terminalReturnFixtures';

const generate = (
  evaluation = createReturnEvaluation(),
  overrides: Partial<Parameters<typeof generateTerminalReturnRecords>[0]> = {},
) =>
  generateTerminalReturnRecords({
    evaluations: [evaluation],
    outcomeRunId: 'terminal-return-run:test',
    now: TERMINAL_RETURN_NOW,
    ...overrides,
  })[0]!;

describe('terminal-return policy and identity', () => {
  it('creates a stable canonical policy fingerprint', () => {
    const left = createTerminalReturnPolicy();
    const right = createTerminalReturnPolicy({
      floatingPointPolicy: {
        relativeTolerance: 1e-12,
        absoluteTolerance: 1e-12,
      },
    });
    expect(left.fingerprint).toBe(right.fingerprint);
  });

  it('changes fingerprint and outcome ID for a policy change', () => {
    const original = createTerminalReturnRecord();
    const policy = createTerminalReturnPolicy({
      floatingPointPolicy: { relativeTolerance: 2e-12 },
    });
    const changed = generate(createReturnEvaluation(), { policy });

    expect(changed.returnPolicy.fingerprint).not.toBe(
      original.returnPolicy.fingerprint,
    );
    expect(changed.outcomeId).not.toBe(original.outcomeId);
  });

  it('keeps outcome ID independent of run ID and recordedAt', () => {
    const first = generate();
    const second = generate(createReturnEvaluation(), {
      outcomeRunId: 'terminal-return-run:other',
      now: TERMINAL_RETURN_NOW + 1,
    });

    expect(second.outcomeId).toBe(first.outcomeId);
    expect(second.outcomeRunId).not.toBe(first.outcomeRunId);
    expect(second.recordedAt).not.toBe(first.recordedAt);
  });

  it('changes outcome ID when source evaluation changes', () => {
    const first = generate(createReturnEvaluation({ sequence: 1 }));
    const second = generate(createReturnEvaluation({ sequence: 2 }));
    expect(second.sourceEvaluationId).not.toBe(first.sourceEvaluationId);
    expect(second.outcomeId).not.toBe(first.outcomeId);
  });
});

describe('terminal-return matrix and raw returns', () => {
  it('preserves all 15 source/horizon cells in Phase D order', () => {
    const evaluation = createReturnEvaluation();
    const record = generate(evaluation);

    expect(record.returns).toHaveLength(15);
    expect(record.returns.map((cell) => [cell.horizonMs, cell.source])).toEqual(
      evaluation.alignments.map((alignment) => [
        alignment.horizonMs,
        alignment.source,
      ]),
    );
  });

  it.each([
    [110, 9.5],
    [90, -10.5],
    [100.5, 0],
  ])(
    'calculates unrounded midpoint raw return for terminal %s',
    (terminal, expected) => {
      const record = generate(createReturnEvaluation({ midpoint: terminal }));
      const cell = record.returns.find(
        (candidate) => candidate.source === 'ORDER_BOOK_MIDPOINT',
      )!;

      expect(cell.rawReturn).toBe(expected);
      expect(cell.rawReturnPercent).toBe((expected / 100.5) * 100);
      expect(cell.referencePrice).toBe(100.5);
      expect(cell.terminalPrice).toBe(terminal);
    },
  );

  it('uses candle close while retaining captured midpoint reference', () => {
    const cell = generate(
      createReturnEvaluation({ candleClose: 105 }),
    ).returns.find(
      (candidate) => candidate.source === 'CONFIRMED_CANDLE_CLOSE',
    )!;

    expect(cell.referencePrice).toBe(100.5);
    expect(cell.terminalPrice).toBe(105);
    expect(cell.rawReturn).toBe(4.5);
    expect(cell.rawPriceBasis).toBe(
      'CAPTURED_MIDPOINT_TO_TERMINAL_CANDLE_CLOSE',
    );
  });

  it('uses a clearly non-executable midpoint comparison for bid/ask raw return', () => {
    const cell = generate().returns.find(
      (candidate) => candidate.source === 'ORDER_BOOK_BID_ASK',
    )!;

    expect(cell.terminalPrice).toBe(110);
    expect(cell.rawReturn).toBe(9.5);
    expect(cell.rawPriceBasis).toBe('CAPTURED_MIDPOINT_TO_TERMINAL_MIDPOINT');
  });

  it('rejects zero, non-finite, and crossed Phase D inputs', () => {
    for (const mutate of [
      (evaluation: ReturnType<typeof createReturnEvaluation>) => {
        evaluation.reference!.midpoint = 0;
      },
      (evaluation: ReturnType<typeof createReturnEvaluation>) => {
        evaluation.reference!.midpoint = Number.POSITIVE_INFINITY;
      },
      (evaluation: ReturnType<typeof createReturnEvaluation>) => {
        evaluation.reference!.bestBid = 102;
        evaluation.reference!.bestAsk = 101;
      },
      (evaluation: ReturnType<typeof createReturnEvaluation>) => {
        const book = evaluation.alignments.find(
          (alignment) => alignment.source === 'ORDER_BOOK_BID_ASK',
        )!.selectedObservation!;
        book.bestBid = 112;
        book.bestAsk = 111;
      },
    ]) {
      const evaluation = createReturnEvaluation();
      mutate(evaluation);
      expect(() => generate(evaluation)).toThrow();
    }
  });
});

describe('directional and executable terminal returns', () => {
  it.each([
    ['BULLISH', 110, 9.5],
    ['BULLISH', 90, -10.5],
    ['BEARISH', 90, 10.5],
    ['BEARISH', 110, -9.5],
  ] as const)(
    '%s bias yields directional return %s at terminal %s',
    (bias, terminal, expected) => {
      const cell = generate(
        createReturnEvaluation({
          okxBias: bias,
          externalBias: bias,
          midpoint: terminal,
        }),
      ).returns.find(
        (candidate) => candidate.source === 'ORDER_BOOK_MIDPOINT',
      )!;

      expect(cell.okxDirectionalReturn).toBe(expected);
      expect(cell.externalDirectionalReturn).toBe(expected);
      expect(cell.okxDirectionalReturnPercent).toBe((expected / 100.5) * 100);
    },
  );

  it('keeps contradiction directions separate without a combined return', () => {
    const cell = generate(
      createReturnEvaluation({
        relationship: 'CONTRADICTION',
        okxBias: 'BULLISH',
        externalBias: 'BEARISH',
      }),
    ).returns.find((candidate) => candidate.source === 'ORDER_BOOK_MIDPOINT')!;

    expect(cell.rawReturn).toBe(9.5);
    expect(cell.okxDirectionalReturn).toBe(9.5);
    expect(cell.externalDirectionalReturn).toBe(-9.5);
    expect(cell).not.toHaveProperty('combinedDirectionalReturn');
  });

  it('omits neutral directional metrics with typed reasons', () => {
    const cell = generate(
      createReturnEvaluation({
        okxBias: 'NEUTRAL',
        externalBias: 'NEUTRAL',
      }),
    ).returns[0]!;

    expect(cell.eligibility).toBe('ELIGIBLE');
    expect(cell.rawReturn).not.toBeNull();
    expect(cell.okxDirectionalReturn).toBeNull();
    expect(cell.externalDirectionalReturn).toBeNull();
    expect(cell.reasons).toEqual([
      TerminalReturnReason.EXTERNAL_BIAS_NEUTRAL,
      TerminalReturnReason.OKX_BIAS_NEUTRAL,
    ]);
  });

  it('calculates bullish ask-to-bid executable returns', () => {
    const cell = generate(
      createReturnEvaluation({
        okxBias: 'BULLISH',
        externalBias: 'BULLISH',
      }),
    ).returns.find((candidate) => candidate.source === 'ORDER_BOOK_BID_ASK')!;

    expect(cell.okxExecutable).toEqual({
      bias: 'BULLISH',
      entryPrice: 101,
      exitPrice: 109,
      rawReturn: 8,
      rawReturnPercent: (8 / 101) * 100,
      directionalReturn: 8,
      directionalReturnPercent: (8 / 101) * 100,
    });
    expect(cell.externalExecutable).toEqual(cell.okxExecutable);
  });

  it('calculates bearish bid-to-ask executable returns independently', () => {
    const cell = generate(
      createReturnEvaluation({
        relationship: 'CONTRADICTION',
        okxBias: 'BULLISH',
        externalBias: 'BEARISH',
      }),
    ).returns.find((candidate) => candidate.source === 'ORDER_BOOK_BID_ASK')!;

    expect(cell.okxExecutable?.rawReturn).toBe(8);
    expect(cell.externalExecutable).toEqual({
      bias: 'BEARISH',
      entryPrice: 100,
      exitPrice: 111,
      rawReturn: -11,
      rawReturnPercent: -11,
      directionalReturn: -11,
      directionalReturnPercent: -11,
    });
  });

  it('does not add fees, slippage, leverage, funding, or position size', () => {
    const executable = generate().returns.find(
      (candidate) => candidate.source === 'ORDER_BOOK_BID_ASK',
    )!.okxExecutable!;
    expect(Object.keys(executable).sort()).toEqual(
      [
        'bias',
        'directionalReturn',
        'directionalReturnPercent',
        'entryPrice',
        'exitPrice',
        'rawReturn',
        'rawReturnPercent',
      ].sort(),
    );
  });
});

describe('strict terminal-return eligibility', () => {
  it.each([
    ['PARTIAL', 'INELIGIBLE', TerminalReturnReason.ALIGNMENT_PARTIAL],
    ['MISSING', 'INELIGIBLE', TerminalReturnReason.ALIGNMENT_MISSING],
    ['AMBIGUOUS', 'AMBIGUOUS', TerminalReturnReason.ALIGNMENT_AMBIGUOUS],
    ['INVALID', 'INELIGIBLE', TerminalReturnReason.ALIGNMENT_INVALID],
  ] as const)(
    'keeps %s alignments explicit and %s',
    (completeness, eligibility, reason) => {
      const evaluation = createReturnEvaluation();
      setAlignmentCompleteness(evaluation, 0, completeness);
      const cell = generate(evaluation).returns[0]!;

      expect(cell.alignmentCompleteness).toBe(completeness);
      expect(cell.eligibility).toBe(eligibility);
      expect(cell.reasons).toContain(reason);
      expect(cell.reasons).toContain(TerminalReturnReason.POLICY_INELIGIBLE);
      expect(cell.rawReturn).toBeNull();
      expect(cell.okxExecutable).toBeNull();
    },
  );
});
