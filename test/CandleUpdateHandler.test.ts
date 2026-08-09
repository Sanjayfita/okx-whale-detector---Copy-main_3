import { describe, expect, it, vi } from 'vitest';

import { CandleUpdateHandler } from '../src/core/CandleUpdateHandler';

import { MarketState } from '../src/core/MarketState';

import type { OKXCandle } from '../src/clients/okx/OKXCandleWebSocketClient';

const createCandle = (
  instId: string,
  timestamp: number,
  overrides: Partial<OKXCandle> = {},
): OKXCandle => ({
  instId,
  timestamp,
  open: 100,
  high: 102,
  low: 99,
  close: 101,
  volume: 1_000,
  volumeCurrency: 1_000,
  volumeCurrencyQuote: 101_000,
  confirm: true,
  ...overrides,
});

describe('CandleUpdateHandler', () => {
  it('stores all candles and logs independently every tenth update', () => {
    const btcState = new MarketState();

    const ethState = new MarketState();

    const marketStates = new Map<string, MarketState>([
      ['BTC-USDT', btcState],
      ['ETH-USDT', ethState],
    ]);

    const logger = vi.fn();

    const handler = new CandleUpdateHandler(marketStates, logger);

    /*
     * Feed 20 unique BTC candles.
     * Unique timestamps ensure
     * CandleHistory stores all 20.
     */
    for (let index = 0; index < 20; index++) {
      handler.handle(createCandle('BTC-USDT', 1_000 + index * 60_000));
    }

    /*
     * Feed 10 unique ETH candles.
     */
    for (let index = 0; index < 10; index++) {
      handler.handle(createCandle('ETH-USDT', 2_000 + index * 60_000));
    }

    /*
     * Every one of the 30 candles
     * reaches CandleHistory.
     */
    expect(btcState.candleHistory.getSize()).toBe(20);

    expect(ethState.candleHistory.getSize()).toBe(10);

    expect(
      btcState.candleHistory.getSize() + ethState.candleHistory.getSize(),
    ).toBe(30);

    /*
     * BTC logs at updates 10 and 20.
     * ETH logs at update 10.
     */
    expect(logger).toHaveBeenCalledTimes(3);

    const messages = logger.mock.calls.map((call) => String(call[0]));

    const btcMessages = messages.filter((message) =>
      message.includes('BTC-USDT'),
    );

    const ethMessages = messages.filter((message) =>
      message.includes('ETH-USDT'),
    );

    expect(btcMessages).toHaveLength(2);

    expect(ethMessages).toHaveLength(1);

    expect(btcMessages[0]).toContain('History: 10');

    expect(btcMessages[1]).toContain('History: 20');

    expect(ethMessages[0]).toContain('History: 10');
  });

  it('does not let BTC updates affect the ETH counter', () => {
    const marketStates = new Map<string, MarketState>([
      ['BTC-USDT', new MarketState()],
      ['ETH-USDT', new MarketState()],
    ]);

    const logger = vi.fn();

    const handler = new CandleUpdateHandler(marketStates, logger);

    for (let index = 0; index < 9; index++) {
      handler.handle(createCandle('BTC-USDT', 1_000 + index));
    }

    for (let index = 0; index < 9; index++) {
      handler.handle(createCandle('ETH-USDT', 2_000 + index));
    }

    expect(logger).not.toHaveBeenCalled();

    handler.handle(createCandle('BTC-USDT', 10_000));

    expect(logger).toHaveBeenCalledTimes(1);

    expect(logger.mock.calls[0]?.[0]).toContain('BTC-USDT');

    handler.handle(createCandle('ETH-USDT', 20_000));

    expect(logger).toHaveBeenCalledTimes(2);

    expect(logger.mock.calls[1]?.[0]).toContain('ETH-USDT');
  });

  it('ignores candles for unknown symbols', () => {
    const marketStates = new Map<string, MarketState>();

    const logger = vi.fn();

    const handler = new CandleUpdateHandler(marketStates, logger);

    handler.handle(createCandle('UNKNOWN-USDT', 1_000));

    expect(logger).not.toHaveBeenCalled();
  });

  it('does not count or log malformed candles', () => {
    const state = new MarketState();
    const logger = vi.fn();
    const handler = new CandleUpdateHandler(
      new Map([['BTC-USDT', state]]),
      logger,
    );

    for (let index = 0; index < 10; index += 1) {
      handler.handle(
        createCandle('BTC-USDT', 1_000 + index, {
          close: Number.NaN,
        }),
      );
    }

    expect(state.candleHistory.getSize()).toBe(0);
    expect(logger).not.toHaveBeenCalled();
  });

  it('allows the counter to restart after reset', () => {
    const state = new MarketState();

    const marketStates = new Map<string, MarketState>([['BTC-USDT', state]]);

    const logger = vi.fn();

    const handler = new CandleUpdateHandler(marketStates, logger);

    for (let index = 0; index < 10; index++) {
      handler.handle(createCandle('BTC-USDT', 1_000 + index));
    }

    expect(logger).toHaveBeenCalledTimes(1);

    handler.reset('BTC-USDT');

    for (let index = 0; index < 9; index++) {
      handler.handle(createCandle('BTC-USDT', 2_000 + index));
    }

    expect(logger).toHaveBeenCalledTimes(1);

    handler.handle(createCandle('BTC-USDT', 3_000));

    expect(logger).toHaveBeenCalledTimes(2);
  });
});
