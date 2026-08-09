import type { ExternalWhaleSignal } from '../../types/ExternalWhaleSignal';
import type { PolymarketLiveAggregation } from './PolymarketLiveAggregator';
import type { PolymarketMarket } from './PolymarketPublicClient';
import { inferPolymarketAsset } from './PolymarketWhaleDetector';

export interface PolymarketLiveSignalFactoryConfig {
  minimumNetNotionalUsd: number;
  maximumConfidence: number;
}

const DEFAULT_CONFIG: PolymarketLiveSignalFactoryConfig = {
  minimumNetNotionalUsd: 5_000,
  maximumConfidence: 80,
};

export class PolymarketLiveSignalFactory {
  private readonly config: PolymarketLiveSignalFactoryConfig;

  public constructor(config: Partial<PolymarketLiveSignalFactoryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (this.config.minimumNetNotionalUsd <= 0) {
      throw new Error('minimumNetNotionalUsd must be greater than zero');
    }
    if (this.config.maximumConfidence <= 0) {
      throw new Error('maximumConfidence must be greater than zero');
    }
  }

  public create(
    market: PolymarketMarket,
    aggregation: PolymarketLiveAggregation,
    receivedAt = Date.now(),
  ): ExternalWhaleSignal {
    if (!aggregation.qualifies) {
      throw new Error(
        'Cannot create a signal from a non-qualifying aggregation',
      );
    }
    if (
      aggregation.direction !== 'BULLISH' &&
      aggregation.direction !== 'BEARISH'
    ) {
      throw new Error('Qualifying aggregation must be directional');
    }

    const absoluteNetUsd = Math.abs(aggregation.netDirectionalNotionalUsd);
    const sizeFactor = Math.min(
      1,
      absoluteNetUsd / Math.max(this.config.minimumNetNotionalUsd * 5, 1),
    );
    const executionFactor = Math.min(1, aggregation.executionCount / 20);
    const confidence = Math.min(
      this.config.maximumConfidence,
      30 + aggregation.dominance * 25 + sizeFactor * 20 + executionFactor * 5,
    );
    const asset = inferPolymarketAsset(
      `${market.question} ${market.category ?? ''}`,
    );
    const underlyingEventId = `polymarket-live:${market.conditionId}:${aggregation.direction}`;

    return {
      id: `${underlyingEventId}:${aggregation.windowEndedAt}`,
      underlyingEventId,
      provider: 'POLYMARKET',
      category: 'PREDICTION_POSITION',
      direction: aggregation.direction,
      occurredAt: aggregation.windowEndedAt,
      receivedAt,
      confidence,
      asset,
      notionalUsd: absoluteNetUsd,
      description:
        `${aggregation.direction} live Polymarket net flow of ` +
        `$${absoluteNetUsd.toFixed(2)} on “${market.question}” ` +
        `across ${aggregation.executionCount} executions ` +
        `(${(aggregation.dominance * 100).toFixed(1)}% dominance).`,
      evidence: [
        {
          provider: 'POLYMARKET',
          providerEventId: `${market.conditionId}:${aggregation.windowEndedAt}`,
          receivedAt,
        },
      ],
      metadata: {
        marketConditionId: market.conditionId,
        marketSlug: market.slug,
        bullishNotionalUsd: aggregation.bullishNotionalUsd,
        bearishNotionalUsd: aggregation.bearishNotionalUsd,
        netDirectionalNotionalUsd: aggregation.netDirectionalNotionalUsd,
        dominance: aggregation.dominance,
        executionCount: aggregation.executionCount,
        windowStartedAt: aggregation.windowStartedAt,
        windowEndedAt: aggregation.windowEndedAt,
        liquidityUsd: market.liquidity,
      },
    };
  }
}
