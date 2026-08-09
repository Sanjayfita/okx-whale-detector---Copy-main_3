import { describe, expect, it } from 'vitest';

import {
  evaluateAtrTradeManagement,
  type OpenTradeManagementState,
} from '../src/strategy/AtrTradeManagement';

const longState = (
  override: Partial<OpenTradeManagementState> = {},
): OpenTradeManagementState => ({
  direction: 'LONG',
  entryPrice: 100,
  currentPrice: 100,
  atr: 2,
  highestPriceSinceEntry: 100,
  lowestPriceSinceEntry: 99,
  currentStopPrice: null,
  structureInvalidationPrice: null,
  partialTakeProfitCompleted: false,
  marketStructureInvalidated: false,
  aggressiveDeltaNormalized: 0.2,
  cvdSlopeNormalized: 0.2,
  ...override,
});

describe('AtrTradeManagement', () => {
  it('places an ATR initial stop and holds before profit triggers', () => {
    const decision = evaluateAtrTradeManagement({ state: longState() });

    expect(decision.action).toBe('HOLD');
    expect(decision.initialStopPrice).toBe(97);
    expect(decision.stopPrice).toBe(97);
    expect(decision.partialTakeProfitPrice).toBe(103.75);
    expect(decision.reasons).toEqual(['INITIAL_STOP']);
    expect(decision.liveExecutionAllowed).toBe(false);
  });

  it('moves the stop beyond break-even only after one R', () => {
    const decision = evaluateAtrTradeManagement({
      state: longState({
        currentPrice: 103,
        highestPriceSinceEntry: 103,
      }),
    });

    expect(decision.action).toBe('HOLD');
    expect(decision.currentRMultiple).toBe(1);
    expect(decision.stopPrice).toBeCloseTo(100.12, 8);
    expect(decision.reasons).toContain('BREAK_EVEN_ACTIVATED');
  });

  it('requests one partial profit at the configured R multiple', () => {
    const decision = evaluateAtrTradeManagement({
      state: longState({
        currentPrice: 104,
        highestPriceSinceEntry: 104,
      }),
    });

    expect(decision.action).toBe('TAKE_PARTIAL_PROFIT');
    expect(decision.reasons).toContain('PARTIAL_TARGET_REACHED');
  });

  it('tightens the stop with an ATR trail after favorable excursion', () => {
    const decision = evaluateAtrTradeManagement({
      state: longState({
        currentPrice: 108,
        highestPriceSinceEntry: 110,
        currentStopPrice: 100.12,
        partialTakeProfitCompleted: true,
      }),
    });

    expect(decision.action).toBe('HOLD');
    expect(decision.stopPrice).toBe(106);
    expect(decision.reasons).toContain('ATR_TRAIL_TIGHTENED');
  });

  it('exits when both aggressive delta and CVD reverse after progress', () => {
    const decision = evaluateAtrTradeManagement({
      state: longState({
        currentPrice: 102,
        highestPriceSinceEntry: 102,
        aggressiveDeltaNormalized: -0.3,
        cvdSlopeNormalized: -0.3,
      }),
    });

    expect(decision.action).toBe('EXIT_FULL');
    expect(decision.reasons).toContain('FLOW_REVERSAL');
  });

  it('exits immediately when market structure is invalidated', () => {
    const decision = evaluateAtrTradeManagement({
      state: longState({ marketStructureInvalidated: true }),
    });

    expect(decision.action).toBe('EXIT_FULL');
    expect(decision.reasons).toContain('MARKET_STRUCTURE_INVALIDATED');
  });

  it('uses symmetric short stops, targets, and trailing logic', () => {
    const decision = evaluateAtrTradeManagement({
      state: {
        ...longState(),
        direction: 'SHORT',
        currentPrice: 92,
        highestPriceSinceEntry: 101,
        lowestPriceSinceEntry: 90,
        currentStopPrice: 99.88,
        partialTakeProfitCompleted: true,
        aggressiveDeltaNormalized: -0.2,
        cvdSlopeNormalized: -0.2,
      },
    });

    expect(decision.action).toBe('HOLD');
    expect(decision.initialStopPrice).toBe(103);
    expect(decision.partialTakeProfitPrice).toBe(96.25);
    expect(decision.stopPrice).toBe(94);
    expect(decision.reasons).toContain('ATR_TRAIL_TIGHTENED');
  });
});
