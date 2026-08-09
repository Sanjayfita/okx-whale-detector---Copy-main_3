import { describe, expect, it } from 'vitest';

import {
  createTradeExplanation,
  type TradeExplanationInput,
} from '../src/explainability/TradeExplanation';

const input = (): TradeExplanationInput => ({
  explanationId: 'explanation-1',
  tradeId: 'trade-1',
  signalId: 'signal-1',
  strategyId: 'derivatives-flow-v1',
  instrumentId: 'BTC-USDT-SWAP',
  generatedAt: 1_700_000_000_000,
  direction: 'LONG',
  entryScore: 0.72,
  exitScore: null,
  scoreComponents: [
    {
      name: 'cvd',
      value: 0.8,
      weight: 0.5,
      contribution: 0.4,
      explanation: 'Positive executed-flow confirmation',
    },
    {
      name: 'open-interest',
      value: 0.64,
      weight: 0.5,
      contribution: 0.32,
      explanation: 'Open interest expanded with price',
    },
  ],
  activeConfirmations: ['4H bullish bias', '5M entry alignment'],
  filters: [
    {
      name: 'spread',
      status: 'PASSED',
      explanation: 'Spread remained below configured maximum',
    },
  ],
  rejectedConditions: ['funding acceleration below optional threshold'],
  regime: {
    directional: 'TRENDING_BULL',
    overlays: ['HIGH_VOLATILITY'],
    confidence: 0.82,
    explanations: ['Higher highs and positive trend efficiency'],
  },
  risk: {
    accountEquity: 10_000,
    riskFraction: 0.005,
    riskAmount: 50,
    positionContracts: 2,
    notional: 2_000,
    leverage: 0.2,
    stopDistancePercent: 2.5,
    portfolioValueAtRisk: 120,
    sizingMethod: 'fractional Kelly constrained by portfolio VaR',
  },
  exitPlan: {
    stopType: 'ATR',
    stopPrice: 49_000,
    stopExplanation: 'Two ATR below entry and outside local structure',
    takeProfitType: 'SCALED_R',
    takeProfitPrices: [52_000, 54_000],
    takeProfitExplanation: 'Scale at 1R and 2R',
  },
  exitReason: null,
  codeCommit: 'commit',
  configurationHash: 'configuration',
  datasetFingerprint: 'dataset',
});

describe('createTradeExplanation', () => {
  it('produces deterministic machine-readable and human-readable reports', () => {
    const first = createTradeExplanation(input());
    const second = createTradeExplanation(input());

    expect(first).toEqual(second);
    expect(first.machineReadable.schemaVersion).toBe(1);
    expect(first.machineReadable.decisionStatus).toBe('APPROVED');
    expect(first.machineReadable.calculationFingerprint).toHaveLength(64);
    expect(first.humanReadable).toContain('Entry score: 0.7200');
    expect(first.humanReadable).toContain('fractional Kelly');
    expect(first.humanReadable).toContain('Live execution allowed: false');
    expect(first.machineReadable.liveExecutionAllowed).toBe(false);
  });

  it('records blocking filters rather than hiding rejected trades', () => {
    const base = input();
    const report = createTradeExplanation({
      ...base,
      filters: [
        ...base.filters,
        {
          name: 'event blackout',
          status: 'BLOCKED',
          explanation: 'FOMC window active',
        },
      ],
    });

    expect(report.machineReadable.decisionStatus).toBe('BLOCKED');
    expect(report.humanReadable).toContain('event blackout=BLOCKED');
  });

  it('marks closed trades with the exact exit reason', () => {
    const report = createTradeExplanation({
      ...input(),
      exitScore: -0.4,
      exitReason: 'TRAILING_STOP_FILLED',
    });

    expect(report.machineReadable.decisionStatus).toBe('EXITED');
    expect(report.humanReadable).toContain('TRAILING_STOP_FILLED');
  });
});
