import type { ExternalWhaleSignal } from '../../types/ExternalWhaleSignal';
import type {
  PolymarketMarket,
  PolymarketTrade,
} from './PolymarketPublicClient';
import {
  inferPolymarketAsset,
  PolymarketWhaleDetector,
} from './PolymarketWhaleDetector';

export interface PolymarketMarketAggregatorConfig {
  minimumNetNotionalUsd: number;
  minimumDominance: number;
  maximumTradeAgeMs: number;
  maximumConfidence: number;
}

export interface PolymarketMarketAggregation {
  market: PolymarketMarket;
  signal?: ExternalWhaleSignal;
  totalTrades: number;
  directionalTrades: number;
  ignoredTrades: number;
  staleTrades: number;
  unknownDirectionTrades: number;
  mismatchedTrades: number;
  bullishNotionalUsd: number;
  bearishNotionalUsd: number;
  netDirectionalNotionalUsd: number;
  dominance: number;
  uniqueWallets: number;
  largestWalletConcentration: number;
}

const DEFAULT_CONFIG: PolymarketMarketAggregatorConfig = {
  minimumNetNotionalUsd: 5_000,
  minimumDominance: 0.15,
  maximumTradeAgeMs: 24 * 60 * 60 * 1_000,
  maximumConfidence: 80,
};

const getResolutionFactor = (market: PolymarketMarket, now: number): number => {
  if (!market.endDate) return 1;

  const endAt = Date.parse(market.endDate);
  if (!Number.isFinite(endAt)) return 1;

  const remainingMs = endAt - now;
  if (remainingMs <= 0) return 0.4;
  if (remainingMs <= 60 * 60 * 1_000) return 0.55;
  if (remainingMs <= 6 * 60 * 60 * 1_000) return 0.7;
  if (remainingMs <= 24 * 60 * 60 * 1_000) return 0.85;
  return 1;
};

export class PolymarketMarketAggregator {
  private readonly config: PolymarketMarketAggregatorConfig;
  private readonly detector: PolymarketWhaleDetector;

  public constructor(
    detector: PolymarketWhaleDetector,
    config: Partial<PolymarketMarketAggregatorConfig> = {},
  ) {
    this.detector = detector;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  public aggregate(
    market: PolymarketMarket,
    trades: readonly PolymarketTrade[],
    now = Date.now(),
  ): PolymarketMarketAggregation {
    let bullishNotionalUsd = 0;
    let bearishNotionalUsd = 0;
    let ignoredTrades = 0;
    let staleTrades = 0;
    let unknownDirectionTrades = 0;
    let mismatchedTrades = 0;
    let directionalTrades = 0;
    let latestOccurredAt = 0;

    const walletNotional = new Map<string, number>();
    const evidence = [] as ExternalWhaleSignal['evidence'];

    for (const trade of trades) {
      const interpreted = this.detector.interpretTrade(trade, market);
      const ageMs = Math.max(0, now - interpreted.occurredAt);

      if (trade.conditionId !== market.conditionId) {
        mismatchedTrades += 1;
        ignoredTrades += 1;
        continue;
      }

      if (ageMs > this.config.maximumTradeAgeMs) {
        staleTrades += 1;
        ignoredTrades += 1;
        continue;
      }

      if (interpreted.direction === 'UNKNOWN') {
        unknownDirectionTrades += 1;
        ignoredTrades += 1;
        continue;
      }

      directionalTrades += 1;
      latestOccurredAt = Math.max(latestOccurredAt, interpreted.occurredAt);

      if (interpreted.direction === 'BULLISH') {
        bullishNotionalUsd += interpreted.notionalUsd;
      } else {
        bearishNotionalUsd += interpreted.notionalUsd;
      }

      const wallet = trade.proxyWallet || 'unknown';
      walletNotional.set(
        wallet,
        (walletNotional.get(wallet) ?? 0) + interpreted.notionalUsd,
      );
      evidence.push({
        provider: 'POLYMARKET',
        providerEventId: `${trade.transactionHash}:${trade.asset}`,
        receivedAt: now,
      });
    }

    const totalDirectionalNotionalUsd = bullishNotionalUsd + bearishNotionalUsd;
    const netDirectionalNotionalUsd = bullishNotionalUsd - bearishNotionalUsd;
    const dominance =
      totalDirectionalNotionalUsd === 0
        ? 0
        : Math.abs(netDirectionalNotionalUsd) / totalDirectionalNotionalUsd;
    const largestWalletNotional = Math.max(0, ...walletNotional.values());
    const largestWalletConcentration =
      totalDirectionalNotionalUsd === 0
        ? 0
        : largestWalletNotional / totalDirectionalNotionalUsd;

    const result: PolymarketMarketAggregation = {
      market,
      totalTrades: trades.length,
      directionalTrades,
      ignoredTrades,
      staleTrades,
      unknownDirectionTrades,
      mismatchedTrades,
      bullishNotionalUsd,
      bearishNotionalUsd,
      netDirectionalNotionalUsd,
      dominance,
      uniqueWallets: walletNotional.size,
      largestWalletConcentration,
    };

    if (
      directionalTrades === 0 ||
      Math.abs(netDirectionalNotionalUsd) < this.config.minimumNetNotionalUsd ||
      dominance < this.config.minimumDominance
    ) {
      return result;
    }

    const direction = netDirectionalNotionalUsd > 0 ? 'BULLISH' : 'BEARISH';
    const sizeScale = Math.min(
      1,
      Math.abs(netDirectionalNotionalUsd) /
        Math.max(this.config.minimumNetNotionalUsd * 5, 1),
    );
    const liquidityImpact = Math.min(
      1,
      Math.abs(netDirectionalNotionalUsd) / Math.max(market.liquidity, 1),
    );
    const independentWalletFactor =
      walletNotional.size <= 1 ? 0 : Math.min(1, (walletNotional.size - 1) / 4);
    const concentrationAdjustment =
      independentWalletFactor * (1 - largestWalletConcentration);
    const resolutionFactor = getResolutionFactor(market, now);
    const confidence = Math.min(
      this.config.maximumConfidence,
      (30 +
        sizeScale * 18 +
        liquidityImpact * 12 +
        dominance * 18 +
        concentrationAdjustment * 8) *
        resolutionFactor,
    );
    const asset = inferPolymarketAsset(
      `${market.question} ${market.category ?? ''}`,
    );
    const absoluteNetUsd = Math.abs(netDirectionalNotionalUsd);

    result.signal = {
      id: `polymarket-market:${market.conditionId}:${latestOccurredAt}`,
      underlyingEventId: `polymarket-market:${market.conditionId}:${latestOccurredAt}`,
      provider: 'POLYMARKET',
      category: 'PREDICTION_POSITION',
      direction,
      occurredAt: latestOccurredAt,
      receivedAt: now,
      confidence,
      asset,
      notionalUsd: absoluteNetUsd,
      description:
        `${direction} net Polymarket flow of $${absoluteNetUsd.toFixed(2)} ` +
        `on “${market.question}” after aggregating ${directionalTrades} directional trades ` +
        `(${(dominance * 100).toFixed(1)}% dominance).`,
      evidence,
      metadata: {
        marketConditionId: market.conditionId,
        marketSlug: market.slug,
        bullishNotionalUsd,
        bearishNotionalUsd,
        netDirectionalNotionalUsd,
        dominance,
        directionalTrades,
        ignoredTrades,
        staleTrades,
        unknownDirectionTrades,
        mismatchedTrades,
        uniqueWallets: walletNotional.size,
        largestWalletConcentration,
        liquidityUsd: market.liquidity,
        resolutionFactor,
      },
    };

    return result;
  }
}
