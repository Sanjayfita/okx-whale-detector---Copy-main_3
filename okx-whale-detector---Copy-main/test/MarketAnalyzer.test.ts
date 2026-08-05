import { describe, expect, it } from 'vitest';

import { MarketAnalyzer } from '../src/core/MarketAnalyzer';

import type { Whale, WhaleSide } from '../src/types/whale';

const createWhale = (side: WhaleSide, notionalQuote: number): Whale => ({
  wallId: 'wall-1',
  side,

  /*
   * All test whales use the same price
   * as the current market price.
   *
   * This makes distanceWeight equal to 1,
   * so the pressure percentages match the
   * notional values used in each test.
   */
  price: 100,
  size: notionalQuote / 100,
  notionalQuote,
  quoteCurrency: 'USDT',
  detectedAt: Date.now(),
});

describe('MarketAnalyzer neutral band', () => {
  it('returns neutral for balanced 50/50 pressure', () => {
    const analyzer = new MarketAnalyzer();

    const signal = analyzer.analyze(
      [createWhale('BID', 500_000), createWhale('ASK', 500_000)],
      100,
    );

    expect(signal.bias).toBe('NEUTRAL');

    expect(signal.bidPressure).toBeCloseTo(50);

    expect(signal.askPressure).toBeCloseTo(50);

    expect(signal.netPressure).toBeCloseTo(0);

    /*
     * At the center of the neutral band,
     * neutral strength is at its maximum.
     */
    expect(signal.confidence).toBe(100);

    expect(signal.reason).toBe('Whale pressure is within the neutral band');
  });

  it('returns neutral for 54/46 pressure', () => {
    const analyzer = new MarketAnalyzer();

    const signal = analyzer.analyze(
      [createWhale('BID', 540_000), createWhale('ASK', 460_000)],
      100,
    );

    expect(signal.bias).toBe('NEUTRAL');

    expect(signal.bidPressure).toBeCloseTo(54);

    expect(signal.askPressure).toBeCloseTo(46);

    expect(signal.netPressure).toBeCloseTo(8);

    /*
     * Neutral strength:
     *
     * (1 - 8 / 10) × 100 = 20
     */
    expect(signal.confidence).toBe(20);
  });

  it('returns bullish with low strength for 60/40 pressure', () => {
    const analyzer = new MarketAnalyzer();

    const signal = analyzer.analyze(
      [createWhale('BID', 600_000), createWhale('ASK', 400_000)],
      100,
    );

    expect(signal.bias).toBe('BULLISH');

    expect(signal.bidPressure).toBeCloseTo(60);

    expect(signal.askPressure).toBeCloseTo(40);

    expect(signal.netPressure).toBeCloseTo(20);

    /*
     * Directional strength:
     *
     * ((20 - 10) / (100 - 10)) × 100
     * = 11.11, rounded to 11.
     */
    expect(signal.confidence).toBe(11);

    expect(signal.reason).toBe('Bid whale pressure exceeds the neutral band');
  });

  it('returns bullish with maximum strength for 100/0 pressure', () => {
    const analyzer = new MarketAnalyzer();

    const signal = analyzer.analyze([createWhale('BID', 1_000_000)], 100);

    expect(signal.bias).toBe('BULLISH');

    expect(signal.bidPressure).toBeCloseTo(100);

    expect(signal.askPressure).toBeCloseTo(0);

    expect(signal.netPressure).toBeCloseTo(100);

    expect(signal.confidence).toBe(100);
  });

  it('returns neutral with zero evidence when there are no whales', () => {
    const analyzer = new MarketAnalyzer();

    const signal = analyzer.analyze([], 100);

    expect(signal.bias).toBe('NEUTRAL');

    expect(signal.confidence).toBe(0);

    expect(signal.bidPressure).toBe(0);

    expect(signal.askPressure).toBe(0);

    expect(signal.netPressure).toBe(0);

    expect(signal.reason).toBe('No active whale walls');
  });

  it('returns bearish with low strength for 40/60 pressure', () => {
    const analyzer = new MarketAnalyzer();

    const signal = analyzer.analyze(
      [createWhale('BID', 400_000), createWhale('ASK', 600_000)],
      100,
    );

    expect(signal.bias).toBe('BEARISH');

    expect(signal.netPressure).toBeCloseTo(-20);

    expect(signal.confidence).toBe(11);

    expect(signal.reason).toBe('Ask whale pressure exceeds the neutral band');
  });
});
