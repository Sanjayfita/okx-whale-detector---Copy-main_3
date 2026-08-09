import { describe, expect, it } from 'vitest';

import { PolymarketLiveAggregator } from '../src/external/providers/polymarket/PolymarketLiveAggregator';

const now = 1_000_000;

const createExecution = (
  overrides: Partial<Parameters<PolymarketLiveAggregator['add']>[0]> = {},
): Parameters<PolymarketLiveAggregator['add']>[0] => ({
  id: 'execution-1',
  marketConditionId: 'market-1',
  occurredAt: now,
  direction: 'BULLISH',
  notionalUsd: 3_000,
  ...overrides,
});

describe('PolymarketLiveAggregator', () => {
  it('combines smaller executions into one qualifying rolling signal', () => {
    const aggregator = new PolymarketLiveAggregator({
      windowMs: 60_000,
      minimumNetNotionalUsd: 5_000,
      minimumDominance: 0.15,
    });

    expect(aggregator.add(createExecution(), now).qualifies).toBe(false);
    const result = aggregator.add(
      createExecution({ id: 'execution-2', notionalUsd: 2_500 }),
      now,
    );

    expect(result).toMatchObject({
      executionCount: 2,
      direction: 'BULLISH',
      bullishNotionalUsd: 5_500,
      bearishNotionalUsd: 0,
      netDirectionalNotionalUsd: 5_500,
      dominance: 1,
      qualifies: true,
    });
  });

  it('nets bullish and bearish executions in the same market', () => {
    const aggregator = new PolymarketLiveAggregator({
      minimumNetNotionalUsd: 1_000,
      minimumDominance: 0.1,
    });

    aggregator.add(createExecution({ notionalUsd: 8_000 }), now);
    const result = aggregator.add(
      createExecution({
        id: 'bearish',
        direction: 'BEARISH',
        notionalUsd: 3_000,
      }),
      now,
    );

    expect(result.bullishNotionalUsd).toBe(8_000);
    expect(result.bearishNotionalUsd).toBe(3_000);
    expect(result.netDirectionalNotionalUsd).toBe(5_000);
    expect(result.dominance).toBeCloseTo(5 / 11);
    expect(result.direction).toBe('BULLISH');
    expect(result.qualifies).toBe(true);
  });

  it('rejects a large but nearly balanced rolling flow', () => {
    const aggregator = new PolymarketLiveAggregator({
      minimumNetNotionalUsd: 500,
      minimumDominance: 0.15,
    });

    aggregator.add(createExecution({ notionalUsd: 10_000 }), now);
    const result = aggregator.add(
      createExecution({
        id: 'bearish',
        direction: 'BEARISH',
        notionalUsd: 9_000,
      }),
      now,
    );

    expect(result.netDirectionalNotionalUsd).toBe(1_000);
    expect(result.dominance).toBeCloseTo(1 / 19);
    expect(result.qualifies).toBe(false);
  });

  it('expires executions outside the rolling window', () => {
    const aggregator = new PolymarketLiveAggregator({
      windowMs: 60_000,
      minimumNetNotionalUsd: 1_000,
    });

    aggregator.add(createExecution({ occurredAt: now - 61_000 }), now - 61_000);
    const result = aggregator.get('market-1', now);

    expect(result.executionCount).toBe(0);
    expect(result.netDirectionalNotionalUsd).toBe(0);
    expect(result.qualifies).toBe(false);
  });

  it('does not count the same WebSocket execution twice', () => {
    const aggregator = new PolymarketLiveAggregator({
      minimumNetNotionalUsd: 1_000,
    });
    const execution = createExecution();

    aggregator.add(execution, now);
    const result = aggregator.add(execution, now);

    expect(result.executionCount).toBe(1);
    expect(result.bullishNotionalUsd).toBe(3_000);
  });

  it('keeps different markets isolated', () => {
    const aggregator = new PolymarketLiveAggregator({
      minimumNetNotionalUsd: 1_000,
    });

    aggregator.add(createExecution(), now);
    aggregator.add(
      createExecution({
        id: 'market-2-execution',
        marketConditionId: 'market-2',
        direction: 'BEARISH',
        notionalUsd: 4_000,
      }),
      now,
    );

    expect(aggregator.get('market-1', now).direction).toBe('BULLISH');
    expect(aggregator.get('market-2', now).direction).toBe('BEARISH');
  });

  it('ignores unknown and neutral executions', () => {
    const aggregator = new PolymarketLiveAggregator({
      minimumNetNotionalUsd: 1_000,
    });

    aggregator.add(createExecution({ direction: 'UNKNOWN' }), now);
    const result = aggregator.add(
      createExecution({ id: 'neutral', direction: 'NEUTRAL' }),
      now,
    );

    expect(result.executionCount).toBe(0);
    expect(result.qualifies).toBe(false);
  });
});
