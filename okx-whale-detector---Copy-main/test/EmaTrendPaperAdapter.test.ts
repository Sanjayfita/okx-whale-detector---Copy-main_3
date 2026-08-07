import { describe, expect, it } from 'vitest';

import {
  createEmaTrendPaperEntryIntent,
  createEmaTrendPaperExitIntent,
  summarizePaperPositions,
} from '../src/paper/EmaTrendPaperAdapter';
import type {
  EmaTrendEntryDecision,
  EmaTrendExitDecision,
} from '../src/strategy/EmaTrendStrategy';

const signalDecision = (): EmaTrendEntryDecision => ({
  strategyId: 'ema-trend-v1',
  strategyVersion: 1,
  instrumentId: 'BTC-USDT-SWAP',
  observedAt: 1_700_000_000_000,
  status: 'SIGNAL',
  direction: 'LONG',
  reasons: [],
  indicators: {
    fastEma: 101,
    slowEma: 100,
    previousFastEma: 99,
    previousSlowEma: 100,
    slowEmaSlopePercent: 0.1,
    rsi: 60,
    atr: 1,
    atrPercent: 1,
  },
  tradePlan: {
    direction: 'LONG',
    entryPrice: 100,
    stopLossPrice: 99,
    takeProfitPrice: 102,
    trailingStopPrice: 99,
    stopDistancePercent: 1,
    takeProfitDistancePercent: 2,
    rewardRiskRatio: 2,
    riskPercent: 1,
    riskAmountQuote: 100,
    notionalQuote: 10_000,
    baseQuantity: 100,
  },
  liveExecutionAllowed: false,
});

describe('EMA trend paper adapter', () => {
  it('converts risk-sized base quantity into paper contracts', () => {
    const intent = createEmaTrendPaperEntryIntent({
      decision: signalDecision(),
      specification: {
        instrumentId: 'BTC-USDT-SWAP',
        tickSize: 0.1,
        lotSize: 1,
        minimumContracts: 1,
        maximumLeverage: 10,
        contractValue: 0.01,
      },
      orderId: 'entry-1',
      submittedAt: 1_700_000_000_001,
    });

    expect(intent).toMatchObject({
      side: 'BUY',
      orderType: 'MARKET',
      requestedContracts: 10_000,
      reduceOnly: false,
    });
  });

  it('creates reduce-only exit intents in the opposite side', () => {
    const entry = signalDecision();
    if (!entry.tradePlan || !entry.instrumentId) {
      throw new Error('test signal is invalid');
    }
    const exit: EmaTrendExitDecision = {
      status: 'EXIT',
      reason: 'TAKE_PROFIT',
      exitPrice: 102,
      position: {
        ...entry.tradePlan,
        instrumentId: entry.instrumentId,
        openedAt: entry.observedAt ?? 0,
        highestPriceSinceEntry: 102,
        lowestPriceSinceEntry: 100,
      },
      liveExecutionAllowed: false,
    };

    const intent = createEmaTrendPaperExitIntent({
      exit,
      position: {
        instrumentId: 'BTC-USDT-SWAP',
        direction: 'LONG',
        contracts: 25,
        contractValue: 0.01,
        averageEntryPrice: 100,
        leverage: 2,
        openedAt: 1_700_000_000_000,
        accumulatedFundingPnl: 0,
      },
      orderId: 'exit-1',
      submittedAt: 1_700_000_060_000,
    });

    expect(intent).toMatchObject({
      side: 'SELL',
      requestedContracts: 25,
      reduceOnly: true,
    });
  });

  it('summarizes paper positions for duplicate-direction checks', () => {
    expect(
      summarizePaperPositions([
        {
          instrumentId: 'ETH-USDT-SWAP',
          direction: 'SHORT',
          contracts: 10,
          contractValue: 0.1,
          averageEntryPrice: 3_000,
          leverage: 2,
          openedAt: 1_700_000_000_000,
          accumulatedFundingPnl: 0,
        },
      ]),
    ).toEqual([
      {
        instrumentId: 'ETH-USDT-SWAP',
        direction: 'SHORT',
      },
    ]);
  });
});
