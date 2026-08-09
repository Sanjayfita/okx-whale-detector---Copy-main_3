import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { ExternalSignalStore } from '../external/core/ExternalSignalStore';
import { PolymarketMarketAggregator } from '../external/providers/polymarket/PolymarketMarketAggregator';
import { PolymarketPublicClient } from '../external/providers/polymarket/PolymarketPublicClient';
import { PolymarketWhaleDetector } from '../external/providers/polymarket/PolymarketWhaleDetector';

interface ScanOptions {
  minimumTradeUsd: number;
  minimumLiquidityUsd: number;
  marketLimit: number;
  tradeLimit: number;
  maximumTradeAgeHours: number;
  reportPath?: string;
}

const parsePositiveNumber = (
  value: string | undefined,
  flag: string,
): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} requires a positive number`);
  }
  return parsed;
};

const parseOptions = (args: readonly string[]): ScanOptions => {
  const options: ScanOptions = {
    minimumTradeUsd: 10_000,
    minimumLiquidityUsd: 25_000,
    marketLimit: 500,
    tradeLimit: 1_000,
    maximumTradeAgeHours: 24,
  };

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];

    if (flag === '--min-trade') {
      options.minimumTradeUsd = parsePositiveNumber(value, flag);
      index += 1;
    } else if (flag === '--min-liquidity') {
      options.minimumLiquidityUsd = parsePositiveNumber(value, flag);
      index += 1;
    } else if (flag === '--market-limit') {
      options.marketLimit = parsePositiveNumber(value, flag);
      index += 1;
    } else if (flag === '--trade-limit') {
      options.tradeLimit = parsePositiveNumber(value, flag);
      index += 1;
    } else if (flag === '--max-age-hours') {
      options.maximumTradeAgeHours = parsePositiveNumber(value, flag);
      index += 1;
    } else if (flag === '--report') {
      options.reportPath = value?.startsWith('--')
        ? 'data/reports/polymarket-whale-scan.json'
        : (value ?? 'data/reports/polymarket-whale-scan.json');
      if (value && !value.startsWith('--')) index += 1;
    } else {
      throw new Error(`Unknown Polymarket scan option: ${flag}`);
    }
  }

  return options;
};

const main = async (): Promise<void> => {
  const options = parseOptions(process.argv.slice(2));
  const maximumTradeAgeMs = options.maximumTradeAgeHours * 60 * 60 * 1_000;
  const client = new PolymarketPublicClient();
  const detector = new PolymarketWhaleDetector({
    minimumLiquidityUsd: options.minimumLiquidityUsd,
    minimumTradeNotionalUsd: options.minimumTradeUsd,
    maximumTradeAgeMs,
  });
  const aggregator = new PolymarketMarketAggregator(detector, {
    minimumNetNotionalUsd: options.minimumTradeUsd,
    maximumTradeAgeMs,
  });
  const store = new ExternalSignalStore();

  const markets = await client.getActiveMarkets(options.marketLimit);
  const relevantMarkets = markets.filter((market) =>
    detector.isRelevantMarket(market),
  );
  const marketsByCondition = new Map(
    relevantMarkets.map((market) => [market.conditionId, market]),
  );
  const trades = await client.getRecentTradesForMarkets(
    options.minimumTradeUsd,
    relevantMarkets.map((market) => market.conditionId),
    options.tradeLimit,
  );

  const tradesByCondition = new Map<string, typeof trades>();
  const unknownExamples = new Map<string, number>();
  let matchedTrades = 0;
  let directionalTrades = 0;
  let unknownDirectionTrades = 0;

  for (const trade of trades) {
    const market = marketsByCondition.get(trade.conditionId);
    if (!market) continue;

    matchedTrades += 1;
    const marketTrades = tradesByCondition.get(trade.conditionId) ?? [];
    marketTrades.push(trade);
    tradesByCondition.set(trade.conditionId, marketTrades);

    const interpretation = detector.interpretTrade(trade, market);
    if (interpretation.direction === 'UNKNOWN') {
      unknownDirectionTrades += 1;
      const key = `${trade.outcome || '(blank outcome)'} | ${market.question}`;
      unknownExamples.set(key, (unknownExamples.get(key) ?? 0) + 1);
    } else {
      directionalTrades += 1;
    }
  }

  const allAggregations = relevantMarkets.map((market) =>
    aggregator.aggregate(
      market,
      tradesByCondition.get(market.conditionId) ?? [],
    ),
  );
  const aggregations = allAggregations.filter(
    (aggregation) => aggregation.directionalTrades > 0,
  );

  for (const aggregation of aggregations) {
    if (aggregation.signal) store.add(aggregation.signal);
  }

  const signals = store.getAll();
  const freshDirectionalTrades = allAggregations.reduce(
    (sum, aggregation) => sum + aggregation.directionalTrades,
    0,
  );
  const staleTrades = allAggregations.reduce(
    (sum, aggregation) => sum + aggregation.staleTrades,
    0,
  );
  const weakNetFlowMarkets = aggregations.filter(
    (aggregation) =>
      !aggregation.signal &&
      Math.abs(aggregation.netDirectionalNotionalUsd) < options.minimumTradeUsd,
  ).length;
  const lowDominanceMarkets = aggregations.filter(
    (aggregation) =>
      !aggregation.signal &&
      Math.abs(aggregation.netDirectionalNotionalUsd) >=
        options.minimumTradeUsd &&
      aggregation.dominance < 0.15,
  ).length;
  const topUnknownExamples = [...unknownExamples.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([example, count]) => ({ example, count }));

  console.log('\nPOLYMARKET WHALE SCAN');
  console.log(`Active markets fetched: ${markets.length}`);
  console.log(`Relevant liquid markets: ${relevantMarkets.length}`);
  console.log(`Relevant-market trades fetched: ${trades.length}`);
  console.log(`Trades matched to discovered markets: ${matchedTrades}`);
  console.log(`Directionally interpreted trades: ${directionalTrades}`);
  console.log(`Unknown-direction trades: ${unknownDirectionTrades}`);
  console.log(
    `Fresh directional trades (≤${options.maximumTradeAgeHours}h): ${freshDirectionalTrades}`,
  );
  console.log(`Stale trades discarded: ${staleTrades}`);
  console.log(
    `Markets with fresh directional activity: ${aggregations.length}`,
  );
  console.log(`Markets rejected for weak net flow: ${weakNetFlowMarkets}`);
  console.log(`Markets rejected for low dominance: ${lowDominanceMarkets}`);
  console.log(`Aggregated whale signals detected: ${signals.length}`);

  if (topUnknownExamples.length > 0) {
    console.log('\nTop unknown outcome/question examples:');
    for (const item of topUnknownExamples) {
      console.log(`- ${item.count}× ${item.example}`);
    }
  }

  for (const signal of signals.slice(0, 20)) {
    const metadata = signal.metadata ?? {};
    const bullishNotionalUsd = Number(metadata.bullishNotionalUsd ?? 0);
    const bearishNotionalUsd = Number(metadata.bearishNotionalUsd ?? 0);
    const dominance = Number(metadata.dominance ?? 0);
    const uniqueWallets = Number(metadata.uniqueWallets ?? 0);
    const largestWalletConcentration = Number(
      metadata.largestWalletConcentration ?? 0,
    );

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`${signal.direction} | ${signal.asset ?? 'MACRO'}`);
    console.log(
      `Net flow: $${(signal.notionalUsd ?? 0).toLocaleString('en-US', {
        maximumFractionDigits: 2,
      })}`,
    );
    console.log(
      `Bullish: $${bullishNotionalUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
    );
    console.log(
      `Bearish: $${bearishNotionalUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
    );
    console.log(`Dominance: ${(dominance * 100).toFixed(1)}%`);
    console.log(
      `Wallets: ${uniqueWallets} | Largest wallet: ${(largestWalletConcentration * 100).toFixed(1)}%`,
    );
    console.log(`Confidence: ${signal.confidence.toFixed(1)}%`);
    console.log(signal.description);
  }

  if (options.reportPath) {
    const report = {
      generatedAt: new Date().toISOString(),
      options,
      activeMarketsFetched: markets.length,
      relevantMarkets: relevantMarkets.length,
      relevantMarketTradesFetched: trades.length,
      matchedTrades,
      directionalTrades,
      unknownDirectionTrades,
      freshDirectionalTrades,
      staleTrades,
      marketsWithDirectionalActivity: aggregations.length,
      weakNetFlowMarkets,
      lowDominanceMarkets,
      topUnknownExamples,
      aggregations: allAggregations,
      whaleSignals: signals,
    };
    mkdirSync(path.dirname(options.reportPath), { recursive: true });
    writeFileSync(
      options.reportPath,
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8',
    );
    console.log(`\nReport: ${options.reportPath}`);
  }
};

void main().catch((error: unknown) => {
  console.error('Polymarket scan failed:', error);
  process.exitCode = 1;
});
