import { describe, expect, it } from 'vitest';

import { createPaperPortfolioSnapshot } from '../src/paperTrading/paperPortfolio';
import { valuePaperPortfolio } from '../src/paperTrading/paperPortfolioValuation';

describe('paper portfolio valuation', () => {
  it('values long and short positions deterministically', () => {
    const portfolio = createPaperPortfolioSnapshot({
      generatedAt: 200,
      initialCash: 10_000,
      fills: [
        {
          fillId: 'fill-1',
          instrumentId: 'BTC-USDT',
          side: 'BUY',
          quantity: 2,
          price: 100,
          fee: 1,
          executedAt: 100,
        },
        {
          fillId: 'fill-2',
          instrumentId: 'ETH-USDT',
          side: 'SELL',
          quantity: 3,
          price: 50,
          fee: 0.5,
          executedAt: 110,
        },
      ],
    });

    const valuation = valuePaperPortfolio({
      generatedAt: 300,
      portfolio,
      marks: [
        { instrumentId: 'ETH-USDT', price: 45, observedAt: 290 },
        { instrumentId: 'BTC-USDT', price: 110, observedAt: 290 },
      ],
    });

    expect(valuation.positions.map((position) => position.instrumentId)).toEqual([
      'BTC-USDT',
      'ETH-USDT',
    ]);
    expect(valuation.positions[0]?.unrealizedPnl).toBe(20);
    expect(valuation.positions[1]?.unrealizedPnl).toBe(15);
    expect(valuation.unrealizedPnl).toBe(35);
    expect(valuation.grossExposure).toBe(355);
    expect(valuation.netExposure).toBe(85);
    expect(valuation.equity).toBe(10_033.5);
  });

  it('requires one valid mark for every open position', () => {
    const portfolio = createPaperPortfolioSnapshot({
      generatedAt: 100,
      initialCash: 1_000,
      fills: [
        {
          fillId: 'fill-1',
          instrumentId: 'BTC-USDT',
          side: 'BUY',
          quantity: 1,
          price: 100,
          fee: 0,
          executedAt: 90,
        },
      ],
    });

    expect(() => valuePaperPortfolio({ generatedAt: 101, portfolio, marks: [] })).toThrow(
      'Missing paper mark for open position: BTC-USDT',
    );
  });

  it('rejects duplicate and future marks', () => {
    const portfolio = createPaperPortfolioSnapshot({
      generatedAt: 100,
      initialCash: 1_000,
      fills: [],
    });

    expect(() =>
      valuePaperPortfolio({
        generatedAt: 110,
        portfolio,
        marks: [
          { instrumentId: 'BTC-USDT', price: 100, observedAt: 100 },
          { instrumentId: 'BTC-USDT', price: 101, observedAt: 100 },
        ],
      }),
    ).toThrow('Duplicate paper mark instrument ID: BTC-USDT');

    expect(() =>
      valuePaperPortfolio({
        generatedAt: 110,
        portfolio,
        marks: [{ instrumentId: 'BTC-USDT', price: 100, observedAt: 111 }],
      }),
    ).toThrow('Mark BTC-USDT cannot be observed after generatedAt');
  });
});
