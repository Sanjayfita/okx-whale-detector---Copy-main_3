import { describe, expect, it } from 'vitest';

import { createPaperPortfolioSnapshot } from '../src/paperTrading/paperPortfolio';

describe('createPaperPortfolioSnapshot', () => {
  it('tracks cash, average entry, fees, and realized PnL deterministically', () => {
    const fills = [
      {
        fillId: 'fill-2',
        instrumentId: 'BTC-USDT',
        side: 'SELL' as const,
        quantity: 1,
        price: 110,
        fee: 1,
        executedAt: 2,
      },
      {
        fillId: 'fill-1',
        instrumentId: 'BTC-USDT',
        side: 'BUY' as const,
        quantity: 2,
        price: 100,
        fee: 1,
        executedAt: 1,
      },
    ];

    const snapshot = createPaperPortfolioSnapshot({
      generatedAt: 3,
      initialCash: 1_000,
      fills,
    });

    expect(snapshot.cash).toBe(908);
    expect(snapshot.realizedPnl).toBe(10);
    expect(snapshot.feesPaid).toBe(2);
    expect(snapshot.fills.map((fill) => fill.fillId)).toEqual(['fill-1', 'fill-2']);
    expect(snapshot.positions).toEqual([
      {
        instrumentId: 'BTC-USDT',
        quantity: 1,
        averageEntryPrice: 100,
        realizedPnl: 10,
      },
    ]);
  });

  it('supports closing and reversing a short position', () => {
    const snapshot = createPaperPortfolioSnapshot({
      generatedAt: 3,
      initialCash: 1_000,
      fills: [
        {
          fillId: 'short-open',
          instrumentId: 'ETH-USDT',
          side: 'SELL',
          quantity: 2,
          price: 50,
          fee: 0,
          executedAt: 1,
        },
        {
          fillId: 'short-reverse',
          instrumentId: 'ETH-USDT',
          side: 'BUY',
          quantity: 3,
          price: 40,
          fee: 0,
          executedAt: 2,
        },
      ],
    });

    expect(snapshot.cash).toBe(980);
    expect(snapshot.realizedPnl).toBe(20);
    expect(snapshot.positions[0]).toEqual({
      instrumentId: 'ETH-USDT',
      quantity: 1,
      averageEntryPrice: 40,
      realizedPnl: 20,
    });
  });

  it('rejects duplicate fills and future fills', () => {
    const duplicate = {
      fillId: 'same-fill',
      instrumentId: 'BTC-USDT',
      side: 'BUY' as const,
      quantity: 1,
      price: 100,
      fee: 0,
      executedAt: 1,
    };

    expect(() =>
      createPaperPortfolioSnapshot({ generatedAt: 1, initialCash: 100, fills: [duplicate, duplicate] }),
    ).toThrow('Duplicate paper fill ID');

    expect(() =>
      createPaperPortfolioSnapshot({
        generatedAt: 1,
        initialCash: 100,
        fills: [{ ...duplicate, fillId: 'future-fill', executedAt: 2 }],
      }),
    ).toThrow('cannot be executed after generatedAt');
  });
});
