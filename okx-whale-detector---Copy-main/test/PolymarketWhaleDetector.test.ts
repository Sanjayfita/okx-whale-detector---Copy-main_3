import { describe, expect, it } from 'vitest';

import type {
  PolymarketMarket,
  PolymarketTrade,
} from '../src/external/providers/polymarket/PolymarketPublicClient';
import { PolymarketWhaleDetector } from '../src/external/providers/polymarket/PolymarketWhaleDetector';

const market: PolymarketMarket = {
  id: '1',
  conditionId: '0xmarket',
  question: 'Will Bitcoin exceed $100,000 this year?',
  slug: 'bitcoin-100k',
  liquidity: 100_000,
  volume: 1_000_000,
};

const trade: PolymarketTrade = {
  proxyWallet: '0xwallet',
  side: 'BUY',
  asset: 'yes-token',
  conditionId: market.conditionId,
  size: 40_000,
  price: 0.5,
  timestamp: 1_000,
  title: market.question,
  slug: market.slug,
  eventSlug: 'bitcoin-event',
  outcome: 'YES',
  outcomeIndex: 0,
  transactionHash: '0xtx',
};

describe('PolymarketWhaleDetector', () => {
  it('accepts liquid crypto markets', () => {
    const detector = new PolymarketWhaleDetector();
    expect(detector.isRelevantMarket(market)).toBe(true);
  });

  it('does not match short asset symbols inside unrelated words', () => {
    const detector = new PolymarketWhaleDetector();

    expect(
      detector.isRelevantMarket({
        ...market,
        question: 'Will the resolution determine whether Team A wins?',
      }),
    ).toBe(false);
    expect(
      detector.isRelevantMarket({
        ...market,
        question: 'Will ETH exceed $5,000?',
      }),
    ).toBe(true);
    expect(
      detector.isRelevantMarket({
        ...market,
        question: 'Will SOL exceed $300?',
      }),
    ).toBe(true);
  });

  it('maps a large BUY YES trade on a positive question to bullish', () => {
    const detector = new PolymarketWhaleDetector();
    const signal = detector.detect(trade, market, 1_000_000);

    expect(signal).toMatchObject({
      provider: 'POLYMARKET',
      category: 'PREDICTION_TRADE',
      direction: 'BULLISH',
      asset: 'BTC',
      notionalUsd: 20_000,
    });
  });

  it('maps BUY NO on a positive question to bearish direction', () => {
    const detector = new PolymarketWhaleDetector();
    const signal = detector.detect(
      { ...trade, outcome: 'NO' },
      market,
      1_000_000,
    );

    expect(signal?.direction).toBe('BEARISH');
  });

  it('reverses direction for negatively worded questions', () => {
    const detector = new PolymarketWhaleDetector();
    const negativeMarket = {
      ...market,
      question: 'Will Bitcoin crash below $50,000 this year?',
    };

    expect(detector.detect(trade, negativeMarket, 1_000_000)?.direction).toBe(
      'BEARISH',
    );
    expect(
      detector.detect({ ...trade, outcome: 'NO' }, negativeMarket, 1_000_000)
        ?.direction,
    ).toBe('BULLISH');
  });

  it('recognizes live downside wording such as dip to a price', () => {
    const detector = new PolymarketWhaleDetector();
    const dipMarket = {
      ...market,
      question: 'Will Bitcoin dip to $55,000 by December 31, 2026?',
    };

    expect(detector.inferQuestionPolarity(dipMarket.question)).toBe('NEGATIVE');
    expect(detector.interpretTrade(trade, dipMarket).direction).toBe('BEARISH');
    expect(
      detector.interpretTrade({ ...trade, outcome: 'NO' }, dipMarket).direction,
    ).toBe('BULLISH');
  });

  it('keeps wallet movement questions directionally unknown', () => {
    const detector = new PolymarketWhaleDetector();
    const movementMarket = {
      ...market,
      question: 'Will Satoshi move any Bitcoin in 2026?',
    };

    expect(detector.inferQuestionPolarity(movementMarket.question)).toBe(
      'UNKNOWN',
    );
    expect(detector.interpretTrade(trade, movementMarket).direction).toBe(
      'UNKNOWN',
    );
  });

  it('maps direct UP and DOWN outcomes without question polarity', () => {
    const detector = new PolymarketWhaleDetector();
    const directionalMarket = {
      ...market,
      question: 'Bitcoin Up or Down - July 27?',
    };

    expect(
      detector.interpretTrade(
        { ...trade, outcome: 'Up', side: 'BUY' },
        directionalMarket,
      ).direction,
    ).toBe('BULLISH');
    expect(
      detector.interpretTrade(
        { ...trade, outcome: 'Down', side: 'BUY' },
        directionalMarket,
      ).direction,
    ).toBe('BEARISH');
    expect(
      detector.interpretTrade(
        { ...trade, outcome: 'Up', side: 'SELL' },
        directionalMarket,
      ).direction,
    ).toBe('BEARISH');
    expect(
      detector.interpretTrade(
        { ...trade, outcome: 'Down', side: 'SELL' },
        directionalMarket,
      ).direction,
    ).toBe('BULLISH');
  });

  it('keeps ambiguous YES or NO wording directionally unknown', () => {
    const detector = new PolymarketWhaleDetector();
    const ambiguousMarket = {
      ...market,
      question: 'What will happen to Bitcoin this month?',
    };

    expect(detector.detect(trade, ambiguousMarket, 1_000_000)?.direction).toBe(
      'UNKNOWN',
    );
  });

  it('accepts both second and millisecond timestamps', () => {
    const detector = new PolymarketWhaleDetector();

    expect(detector.interpretTrade(trade, market).occurredAt).toBe(1_000_000);
    expect(
      detector.interpretTrade(
        { ...trade, timestamp: 1_700_000_000_000 },
        market,
      ).occurredAt,
    ).toBe(1_700_000_000_000);
  });

  it('rejects small, stale, or illiquid activity', () => {
    const detector = new PolymarketWhaleDetector({ maximumTradeAgeMs: 1_000 });

    expect(
      detector.detect({ ...trade, size: 100 }, market, 1_000_000),
    ).toBeUndefined();
    expect(detector.detect(trade, market, 2_100_001)).toBeUndefined();
    expect(
      detector.detect(trade, { ...market, liquidity: 100 }, 1_000_000),
    ).toBeUndefined();
  });
});
